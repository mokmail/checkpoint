// Minimal template engine for agent dynamic variables (spec §2.7.3).
// Supports {{variableName}} and {{variableName|default}} syntax.

export interface AgentVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  defaultValue?: unknown;
  required?: boolean;
  options?: string[];
}

/**
 * Renders a template by replacing {{var}} placeholders with provided values
 * (or variable defaults). Unknown placeholders are left as-is.
 */
export function renderTemplate(
  template: string,
  values: Record<string, unknown> = {},
  variables: AgentVariable[] = [],
): string {
  // build a defaults map from the variable definitions
  const defaults: Record<string, unknown> = {};
  for (const v of variables) {
    if (v.defaultValue !== undefined) defaults[v.name] = v.defaultValue;
  }
  const merged = { ...defaults, ...values };
  return template.replace(/\{\{\s*([\w]+)(?:\|([^}]+))?\s*\}\}/g, (_match, name: string, fallback?: string) => {
    if (merged[name] !== undefined && merged[name] !== null) return String(merged[name]);
    if (fallback !== undefined) return fallback.trim();
    return '';
  });
}

/** Validates provided values against variable definitions; returns { valid, errors }. */
export function validateVariables(
  values: Record<string, unknown>,
  variables: AgentVariable[] = [],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const v of variables) {
    const val = values[v.name];
    if (v.required && (val === undefined || val === null || val === '')) {
      errors.push(`Variable "${v.name}" is required`);
      continue;
    }
    if (val === undefined || val === null) continue;
    if (v.type === 'number' && isNaN(Number(val))) errors.push(`Variable "${v.name}" must be a number`);
    if (v.type === 'boolean' && !['true', 'false', true, false].includes(val as never)) errors.push(`Variable "${v.name}" must be a boolean`);
    if (v.type === 'select' && v.options && !v.options.includes(String(val))) errors.push(`Variable "${v.name}" must be one of: ${v.options.join(', ')}`);
  }
  return { valid: errors.length === 0, errors };
}