// Identifiers Portal+ shares with other apps on the Retail inMotion work site.
// They are protocol identifiers, not branding: they must match exactly what
// those apps write, so the brand check exempts this file only.

// Retail inMotion Smart Approval Manager writes this issue property (it kept
// the original identifiers when it was split; see its portal-plus-contract.js).
export const SMART_APPROVAL_PROPERTY_KEY = 'nuvriqo.smart-approval.portal';
export const SMART_APPROVAL_PROVIDER = 'nuvriqo-smart-approval-manager';

// Retail inMotion Asset Manager publishes its portal snapshot here.
export const ASSET_PROPERTY_KEY = 'retailinmotion.asset-manager.portal';
export const ASSET_MANAGER_PROVIDER = 'retailinmotion-asset-manager';

// Apps that want a tab in the Portal+ menu bar write a project property with
// this prefix (see companion-menu.js).
export const MENU_PROPERTY_PREFIX = 'retailinmotion.portalplus.menu.';
