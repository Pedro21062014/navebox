# Security policy

Please do not open public issues for vulnerabilities involving sandbox escapes, token disclosure, path traversal or deployment target access. Report privately through GitHub Security Advisories for this repository.

Supported version: latest release only.

Never place GitHub, npm, Supabase service-role, SSH or Kubernetes credentials in browser code. The compatibility Node provider requires explicit same-origin trust and must not execute untrusted public input. Use BrowserPod or the Docker Runner boundary for untrusted workloads.
