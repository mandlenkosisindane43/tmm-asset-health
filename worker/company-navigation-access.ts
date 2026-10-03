const STAFF_ROLES = new Set(['engineer']);
const OPERATIONAL_VIEWS = new Set(['dashboard', 'recommendations', 'fleet', 'daily', 'previous', 'breakdowns', 'maintenance', 'production', 'reports-live', 'reports-admin', 'alerts', 'documents', 'install']);
export function isCompanyAdmin(role: string): boolean {
  return role === 'company_admin' || role === 'admin';
}
export function canViewCompanyPage(role: string, view: string): boolean {
  return isCompanyAdmin(role) || (STAFF_ROLES.has(role) && OPERATIONAL_VIEWS.has(view));
}
export function canChangeCompanyPage(role: string, path: string): boolean {
  if (isCompanyAdmin(role)) return true;
  return role === 'engineer' && path === '/company-admin/recommendations';
}
export function filterCompanyForms(body: string, role: string): string {
  if (isCompanyAdmin(role)) return body;
  return body.replace(/<form\b[^>]*action="([^"]+)"[^>]*>[\s\S]*?<\/form>/g, (form, path) =>
    path.startsWith('/company-admin/') && !canChangeCompanyPage(role, path) ? '' : form);
}
