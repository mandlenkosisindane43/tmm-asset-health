const STAFF_ROLES = new Set(['manager', 'engineer', 'supervisor', 'mechanic']);
const OPERATIONAL_VIEWS = new Set(['dashboard', 'fleet', 'daily', 'previous', 'breakdowns', 'maintenance', 'production', 'reports-live', 'reports-admin', 'alerts', 'documents', 'install']);
export function isCompanyAdmin(role: string): boolean {
  return role === 'company_admin' || role === 'admin';
}
export function canViewCompanyPage(role: string, view: string): boolean {
  return isCompanyAdmin(role) || (STAFF_ROLES.has(role) && OPERATIONAL_VIEWS.has(view));
}
export function canChangeCompanyPage(role: string, path: string): boolean {
  if (isCompanyAdmin(role)) return true;
  if (!STAFF_ROLES.has(role)) return false;
  if (path === '/company-admin/documents/upload') return true;
  return ['engineer', 'supervisor', 'mechanic'].includes(role) && path === '/company-admin/daily/manual';
}
export function filterCompanyForms(body: string, role: string): string {
  if (isCompanyAdmin(role)) return body;
  return body.replace(/<form\b[^>]*action="([^"]+)"[^>]*>[\s\S]*?<\/form>/g, (form, path) =>
    path.startsWith('/company-admin/') && !canChangeCompanyPage(role, path) ? '' : form);
}
