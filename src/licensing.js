// Retail inMotion's internal edition of Portal+ is not sold through the
// Atlassian Marketplace, so there is no licence to check: it is always active.
// The function keeps the shape the resolvers expect.
export function licenseState() {
  return { active: true, internal: true };
}
