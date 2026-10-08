const k8s = require('@kubernetes/client-node');
const fs = require('fs');
const path = require('path');

const kc = new k8s.KubeConfig();

if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
} else if (process.env.KUBECONFIG && fs.existsSync(process.env.KUBECONFIG)) {
    kc.loadFromFile(process.env.KUBECONFIG);
} else {
    let carregado = false;
    try {
        kc.loadFromDefault();
        if (kc.getCurrentCluster()) {
            carregado = true;
        }
    } catch {}

    if (!carregado) {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const microk8sPaths = [
            '/var/snap/microk8s/current/credentials/client.config',
            homeDir ? path.join(homeDir, '.kube', 'microk8s.config') : null,
            homeDir ? path.join(homeDir, '.kube', 'config') : null
        ].filter(Boolean);

        for (const p of microk8sPaths) {
            if (fs.existsSync(p)) {
                try {
                    kc.loadFromFile(p);
                    carregado = true;
                    break;
                } catch {}
            }
        }
    }

    if (!carregado) {
        kc.loadFromDefault();
    }
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sExec = new k8s.Exec(kc);

module.exports = {
    k8sApi,
    k8sExec,
    namespace: process.env.K8S_NAMESPACE || 'default'
};