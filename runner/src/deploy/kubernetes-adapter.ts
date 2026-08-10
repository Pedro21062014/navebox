import type { DeployAdapter, DeploymentContext, DeploymentRecord } from '../types.js';
import { runProcess } from '../util/process.js';

export interface KubernetesTarget {
  namespace?: string;
  ingressDomain: string;
  context?: string;
  ingressClass?: string;
  replicas?: number;
}

export class KubernetesAdapter implements DeployAdapter {
  readonly kind = 'kubernetes' as const;

  constructor(
    private readonly targets: Record<string, KubernetesTarget>,
    private readonly kubectlBinary = 'kubectl',
  ) {}

  async deploy(context: DeploymentContext): Promise<{ url: string }> {
    const targetId = context.deployment.target;
    const target = targetId ? this.targets[targetId] : undefined;
    if (!target || !targetId) throw new Error(`Target Kubernetes não configurado: ${targetId ?? '(vazio)'}`);
    if (!context.image) throw new Error('O adapter Kubernetes requer uma imagem OCI já publicada em “image”.');
    validateTarget(target);
    const manifest = createManifest(context, target);
    const result = await runProcess(this.kubectlBinary, kubectlArgs(target, ['apply', '-f', '-']), {
      input: JSON.stringify(manifest),
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) throw new Error(`kubectl apply falhou: ${result.stderr || result.stdout}`);
    return { url: `https://${context.deployment.slug}.${target.ingressDomain}/` };
  }

  async remove(deployment: DeploymentRecord): Promise<void> {
    const target = deployment.target ? this.targets[deployment.target] : undefined;
    if (!target) return;
    await runProcess(this.kubectlBinary, kubectlArgs(target, [
      'delete', 'deployment,service,ingress', '-l', `navebox.dev/deployment=${deployment.id}`, '--ignore-not-found=true',
    ]), { timeoutMs: 60_000 }).catch(() => undefined);
  }
}

function createManifest(context: DeploymentContext, target: KubernetesTarget) {
  const name = `navebox-${context.deployment.slug}`.slice(0, 63).replace(/-+$/g, '');
  const namespace = target.namespace ?? 'navebox';
  const labels = { app: name, 'navebox.dev/deployment': context.deployment.id };
  return {
    apiVersion: 'v1',
    kind: 'List',
    items: [
      {
        apiVersion: 'apps/v1', kind: 'Deployment',
        metadata: { name, namespace, labels },
        spec: {
          replicas: target.replicas ?? 1,
          selector: { matchLabels: { app: name } },
          template: {
            metadata: { labels },
            spec: {
              automountServiceAccountToken: false,
              securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
              containers: [{
                name: 'app', image: context.image,
                ports: [{ name: 'http', containerPort: 3000 }],
                env: [
                  { name: 'PORT', value: '3000' },
                  { name: 'HOST', value: '0.0.0.0' },
                  ...Object.entries(context.env).map(([name, value]) => ({ name, value })),
                ],
                resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '768Mi' } },
                securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
                readinessProbe: { httpGet: { path: '/', port: 'http' }, initialDelaySeconds: 3, periodSeconds: 5 },
              }],
            },
          },
        },
      },
      {
        apiVersion: 'v1', kind: 'Service', metadata: { name, namespace, labels },
        spec: { selector: { app: name }, ports: [{ name: 'http', port: 80, targetPort: 'http' }] },
      },
      {
        apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: {
          name, namespace, labels,
          annotations: target.ingressClass ? { 'kubernetes.io/ingress.class': target.ingressClass } : undefined,
        },
        spec: { rules: [{ host: `${context.deployment.slug}.${target.ingressDomain}`, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name, port: { name: 'http' } } } }] } }] },
      },
    ],
  };
}

function kubectlArgs(target: KubernetesTarget, args: string[]): string[] {
  return [...(target.context ? ['--context', target.context] : []), ...args];
}
function validateTarget(target: KubernetesTarget): void {
  if (!/^[a-z0-9.-]+$/i.test(target.ingressDomain)) throw new Error('Ingress domain inválido.');
  if (target.namespace && !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(target.namespace)) throw new Error('Namespace inválido.');
}
