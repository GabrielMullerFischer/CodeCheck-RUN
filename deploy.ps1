$ErrorActionPreference = "Continue"

$NAMESPACE = "codecheck"
$ENV_FILE = Join-Path $PSScriptRoot ".env"
$YAML_FILE = Join-Path $PSScriptRoot "codecheck.yaml"
$APP_IMAGE = "codecheck-app:latest"
$GCC_IMAGE = "gcc:latest"
$PULL_POLICY = "IfNotPresent"

if (-not (Test-Path $ENV_FILE)) {
    Write-Host "[ERRO] Arquivo .env nao encontrado em $ENV_FILE" -ForegroundColor Red
    exit 1
}

# Detecta no do cluster local (ex.: desktop-control-plane ou docker-desktop)
$TARGET_NODE = (kubectl get nodes -o jsonpath="{.items[0].metadata.name}" 2>$null)
if ([string]::IsNullOrWhiteSpace($TARGET_NODE)) {
    Write-Host "[ERRO] Nenhum no Kubernetes detectado. Verifique se o Kubernetes do Docker Desktop esta ativo." -ForegroundColor Red
    exit 1
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Deploy do CodeCheck-RUN (Windows / Docker Desktop)" -ForegroundColor Cyan
Write-Host "   Modo:        Single-Node Local ($TARGET_NODE)"
Write-Host "   Namespace:   $NAMESPACE"
Write-Host "   App Image:   $APP_IMAGE"
Write-Host "   GCC Image:   $GCC_IMAGE"
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Garantir existencia do Namespace
Write-Host "[1/6] Verificando/criando namespace '$NAMESPACE'..."
$nsOut = kubectl get ns $NAMESPACE 2>&1
if ($LASTEXITCODE -ne 0) {
    kubectl create ns $NAMESPACE | Out-Null
}

# 2. Construir imagem Docker localmente
Write-Host "[2/6] Construindo imagem Docker da aplicacao ($APP_IMAGE)..."
Push-Location $PSScriptRoot
try {
    docker build -t $APP_IMAGE .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERRO] Falha ao construir imagem Docker $APP_IMAGE" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# 3. Garantir imagem gcc:latest local
Write-Host "[3/6] Verificando imagem do compilador ($GCC_IMAGE)..."
$gccCheck = docker image inspect $GCC_IMAGE 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "      Baixando imagem $GCC_IMAGE..."
    docker pull $GCC_IMAGE
}

# 4. Sincronizar Secret no namespace dedicado
Write-Host "[4/6] Sincronizando Secret 'codecheck-env'..."
$TEMP_ENV = [System.IO.Path]::GetTempFileName()
try {
    $seenKeys = @{}
    $envLines = [System.Collections.Generic.List[string]]::new()

    foreach ($line in Get-Content $ENV_FILE) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^[A-Za-z0-9_]+=') {
            $parts = $trimmed -split '=', 2
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            if ($key -in @('K8S_NAMESPACE', 'K8S_IMAGE', 'K8S_IMAGE_PULL_POLICY', 'K8S_WORKER_NODE')) {
                continue
            }
            # No Docker Desktop (Windows), 'localhost' dentro do Pod aponta para o proprio Pod.
            # Para acessar o MinIO rodando no Docker do Windows, usa host.docker.internal.
            if ($key -eq 'MINIO_ENDPOINT' -and ($val -eq 'localhost' -or $val -eq '127.0.0.1')) {
                $val = 'host.docker.internal'
            }
            if (-not $seenKeys.ContainsKey($key)) {
                $seenKeys[$key] = $true
                $envLines.Add("$key=$val")
            }
        }
    }

    $envLines.Add("K8S_NAMESPACE=$NAMESPACE")
    $envLines.Add("K8S_IMAGE=$GCC_IMAGE")
    $envLines.Add("K8S_IMAGE_PULL_POLICY=$PULL_POLICY")
    $envLines.Add("K8S_WORKER_NODE=$TARGET_NODE")

    [System.IO.File]::WriteAllLines($TEMP_ENV, $envLines, (New-Object System.Text.UTF8Encoding($false)))

    $secretYaml = kubectl create secret generic codecheck-env `
        --from-env-file="$TEMP_ENV" `
        --namespace="$NAMESPACE" `
        --dry-run=client -o yaml
    $secretYaml | kubectl apply -f - | Out-Null
} finally {
    if (Test-Path $TEMP_ENV) {
        Remove-Item $TEMP_ENV -Force
    }
}

# 5. Aplicar manifesto base e ajustar Deployment para o no local
Write-Host "[5/6] Aplicando manifesto 'codecheck.yaml'..."
$applyOut = kubectl apply -f $YAML_FILE 2>&1
kubectl set image deployment/codecheck-app codecheck-server="$APP_IMAGE" -n $NAMESPACE 2>&1 | Out-Null

$TEMP_PATCH = [System.IO.Path]::GetTempFileName()
try {
    $patchObj = @{
        spec = @{
            template = @{
                spec = @{
                    nodeSelector = @{
                        "kubernetes.io/hostname" = $TARGET_NODE
                    }
                    dnsPolicy = "ClusterFirst"
                    dnsConfig = $null
                }
            }
        }
    }
    $patchJson = $patchObj | ConvertTo-Json -Depth 10 -Compress
    [System.IO.File]::WriteAllText($TEMP_PATCH, $patchJson, (New-Object System.Text.UTF8Encoding($false)))
    $patchOut = kubectl patch deployment codecheck-app -n $NAMESPACE --type=merge --patch-file="$TEMP_PATCH" 2>&1
} finally {
    if (Test-Path $TEMP_PATCH) {
        Remove-Item $TEMP_PATCH -Force
    }
}

# 6. Reiniciar aplicacao e aguardar Pod
Write-Host "[6/6] Reiniciando aplicacao..."
kubectl rollout restart deployment codecheck-app -n $NAMESPACE | Out-Null

Write-Host "Aguardando Pod atingir estado Ready (timeout 120s)..." -ForegroundColor Yellow
kubectl rollout status deployment codecheck-app -n $NAMESPACE --timeout=120s

Write-Host "==================================================" -ForegroundColor Green
Write-Host "Deploy finalizado com sucesso no namespace '$NAMESPACE'!" -ForegroundColor Green
Write-Host "   App Web (NodePort): http://localhost:30000" -ForegroundColor Green
Write-Host "   LTI Auth (NodePort): http://localhost:30001" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
kubectl get pods -n $NAMESPACE -o wide
