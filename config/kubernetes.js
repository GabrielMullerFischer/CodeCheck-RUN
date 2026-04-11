const k8s = require('@kubernetes/client-node');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sExec = new k8s.Exec(kc);

module.exports = {
    k8sApi,
    k8sExec,
    namespace: process.env.K8S_NAMESPACE || 'default'
};