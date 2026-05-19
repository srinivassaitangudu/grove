export interface TemplateVars {
  port: number;
  agent_name: string;
  base_port: number;
  services: Record<string, { port: number; url: string }>;
}

export function resolveTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    // Simple variables: ${port}, ${agent_name}, ${base_port}
    switch (key) {
      case 'port':
        return String(vars.port);
      case 'agent_name':
        return vars.agent_name;
      case 'base_port':
        return String(vars.base_port);
    }

    // Cross-references: ${services.<name>.port} or ${services.<name>.url}
    const serviceMatch = key.match(/^services\.([^.]+)\.(\w+)$/);
    if (serviceMatch) {
      const [, serviceName, field] = serviceMatch;
      const service = vars.services[serviceName];
      if (!service) {
        throw new Error(`Unknown service in template: \${services.${serviceName}.${field}} — no service named '${serviceName}'`);
      }
      if (field === 'port') {
        return String(service.port);
      }
      if (field === 'url') {
        return service.url;
      }
      throw new Error(`Unknown field in template: \${services.${serviceName}.${field}} — use 'port' or 'url'`);
    }

    throw new Error(`Unknown template variable: \${${key}}`);
  });
}

export function resolveEnvVars(envVars: Record<string, string>, vars: TemplateVars): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(envVars)) {
    resolved[key] = resolveTemplate(template, vars);
  }
  return resolved;
}
