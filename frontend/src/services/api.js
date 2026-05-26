import axios from 'axios';

const API_BASE_URL = '/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if it exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  getCurrentUser: () =>
    api.get('/auth/me'),

  // Password login (Phase 40b)
  login: (identifier, password) =>
    api.post('/auth/login', { identifier, password }),

  // Phone OTP for registration (Phase 40b)
  sendCode: (phoneNumber, intent) =>
    api.post('/auth/send-code', { phoneNumber, intent }),

  verifyRegister: (phoneNumber, code, username, email, password, tosAccepted, tosVersion) =>
    api.post('/auth/verify-register', { phoneNumber, code, username, email, password, ageVerified: tosAccepted, tosAccepted, tosVersion }),

  // Forgot password (Phase 40b)
  forgotPasswordSendCode: (phoneNumber) =>
    api.post('/auth/forgot-password/send-code', { phoneNumber }),

  forgotPasswordReset: (phoneNumber, code, newPassword) =>
    api.post('/auth/forgot-password/reset', { phoneNumber, code, newPassword }),

  logoutEverywhere: () =>
    api.post('/auth/logout-everywhere'),

  deleteAccount: () =>
    api.post('/auth/delete-account'),

  // Phase 41a: ORCID OAuth
  getOrcidAuthorizeUrl: () =>
    api.get('/auth/orcid/authorize-url'),

  orcidCallback: (code) =>
    api.post('/auth/orcid/callback', { code }),

  devConnectOrcid: (orcidId) =>
    api.post('/auth/orcid/dev-connect', { orcidId }),

  // Phase 61b: ORCID-first registration + email-based auth
  beginOrcidRegistration: (code, redirectUri) =>
    api.post('/auth/orcid/begin-registration', { code, redirectUri }),

  registerWithOrcid: (data) =>
    api.post('/auth/register-with-orcid', data),

  forgotPassword: (identifier) =>
    api.post('/auth/forgot-password', { identifier }),

  resetPassword: (token, newPassword) =>
    api.post('/auth/reset-password', { token, newPassword }),
};

// Concepts endpoints
export const conceptsAPI = {
  getRootConcepts: (sort) =>
    api.get('/concepts/root', { params: { sort } }),

  getConceptWithChildren: (id, path, sort) =>
    api.get(`/concepts/${id}`, { params: { path, sort } }),

  getConceptParents: (id, originPath) =>
    api.get(`/concepts/${id}/parents`, { params: { originPath } }),

  getConceptNames: (ids) =>
    api.get('/concepts/names/batch', { params: { ids } }),

  searchConcepts: (query, parentId, path, attributeId) =>
    api.get('/concepts/search', { params: { q: query, parentId, path, ...(attributeId ? { attributeId } : {}) } }),

  getAttributes: () =>
    api.get('/concepts/attributes'),

  getVoteSets: (id, path) =>
    api.get(`/concepts/${id}/votesets`, { params: { path } }),

  getSubtree: (conceptId, path) =>
    api.get(`/concepts/${conceptId}/subtree`, { params: path ? { path } : {} }),

  createRootConcept: (name, attributeId) =>
    api.post('/concepts/root', { name, attributeId }),

  createChildConcept: (name, parentId, path) =>
    api.post('/concepts/child', { name, parentId, path }),

  // Phase 14a: Batch children for diff modal
  getBatchChildrenForDiff: (panes) =>
    api.post('/concepts/batch-children-for-diff', { panes }),
};

// Votes endpoints
export const votesAPI = {
  // Phase 59b: Unified votes endpoint
  getAllVotes: () =>
    api.get('/votes/me/all'),

  // Get user's saved edges (for Saved Page) — optionally filtered by tabId
  getUserSaves: (tabId) =>
    api.get('/votes/saved', { params: tabId ? { tabId } : {} }),

  // Saved Tabs
  getUserTabs: () =>
    api.get('/votes/tabs'),

  createTab: (name) =>
    api.post('/votes/tabs/create', { name }),

  renameTab: (tabId, name) =>
    api.post('/votes/tabs/rename', { tabId, name }),

  deleteTab: (tabId) =>
    api.post('/votes/tabs/delete', { tabId }),

  // Graph Tabs (Phase 5c — persistent in-app navigation tabs)
  getGraphTabs: () =>
    api.get('/votes/graph-tabs'),

  createGraphTab: (tabType, conceptId, path, viewMode, label) =>
    api.post('/votes/graph-tabs/create', { tabType, conceptId, path, viewMode, label }),

  updateGraphTab: (tabId, updates) =>
    api.post('/votes/graph-tabs/update', { tabId, ...updates }),

  closeGraphTab: (tabId) =>
    api.post('/votes/graph-tabs/close', { tabId }),

  // Tab Groups (Phase 5d)
  getTabGroups: () =>
    api.get('/votes/tab-groups'),

  createTabGroup: (name) =>
    api.post('/votes/tab-groups/create', { name }),

  renameTabGroup: (groupId, name) =>
    api.post('/votes/tab-groups/rename', { groupId, name }),

  deleteTabGroup: (groupId) =>
    api.post('/votes/tab-groups/delete', { groupId }),

  toggleTabGroup: (groupId, isExpanded) =>
    api.post('/votes/tab-groups/toggle', { groupId, isExpanded }),

  addTabToGroup: (tabType, tabId, groupId) =>
    api.post('/votes/tab-groups/add-tab', { tabType, tabId, groupId }),

  removeTabFromGroup: (tabType, tabId) =>
    api.post('/votes/tab-groups/remove-tab', { tabType, tabId }),

  // Saved Tree Order (Phase 5e) — LEGACY, used by old saved tabs
  getTreeOrder: (tabId) =>
    api.get('/votes/tree-order', { params: { tabId } }),

  updateTreeOrder: (tabId, order) =>
    api.post('/votes/tree-order/update', { tabId, order }),

  // path is an array of concept IDs from root to the concept being saved
  addVote: (edgeId, path) =>
    api.post('/votes/add', { edgeId, path: path || [] }),

  removeVote: (edgeId) =>
    api.post('/votes/remove', { edgeId }),

  // Remove a save from a specific tab only (keeps vote if linked to other tabs)
  removeVoteFromTab: (edgeId, tabId) =>
    api.post('/votes/remove-from-tab', { edgeId, tabId }),

  // Link votes (similarity votes — Flip View only)
  addLinkVote: (originEdgeId, similarEdgeId) =>
    api.post('/votes/link/add', { originEdgeId, similarEdgeId }),

  removeLinkVote: (originEdgeId, similarEdgeId) =>
    api.post('/votes/link/remove', { originEdgeId, similarEdgeId }),

  // Swap votes (replace votes)
  getSwapVotes: (edgeId) =>
    api.get(`/votes/swap/${edgeId}`),

  addSwapVote: (edgeId, replacementEdgeId) =>
    api.post('/votes/swap/add', { edgeId, replacementEdgeId }),

  removeSwapVote: (edgeId, replacementEdgeId) =>
    api.post('/votes/swap/remove', { edgeId, replacementEdgeId }),

  // Sidebar Items (Phase 19b)
  getSidebarItems: () =>
    api.get('/votes/sidebar-items'),

  reorderSidebarItems: (items) =>
    api.post('/votes/sidebar-items/reorder', { items }),

  // Web Links (Phase 6)
  getWebLinks: (edgeId, sort) =>
    api.get(`/votes/web-links/${edgeId}`, { params: sort ? { sort } : {} }),

  getWebLinksByUrl: (url) =>
    api.get('/votes/web-links/by-url', { params: { url } }),

  getAllWebLinksForConcept: (conceptId, path) =>
    api.get(`/votes/web-links/all/${conceptId}`, { params: path ? { path } : {} }),

  addWebLink: (edgeId, url, title, comment) =>
    api.post('/votes/web-links/add', { edgeId, url, title: title || undefined, comment: comment || undefined }),

  copyWebLink: (sourceLinkId, destEdgeId) =>
    api.post('/votes/web-links/copy', { sourceLinkId, destEdgeId }),

  upvoteWebLink: (linkId) =>
    api.post('/votes/web-links/upvote', { linkId }),

  removeWebLinkVote: (linkId) =>
    api.post('/votes/web-links/unvote', { linkId }),

  removeWebLink: (linkId) =>
    api.post('/votes/web-links/remove', { linkId }),

  previewTitle: (url) =>
    api.get('/votes/web-links/preview-title', { params: { url } }),

  addConceptLinkAddendum: (linkId, body) =>
    api.post(`/votes/web-links/${linkId}/addenda`, { body }),

  getMyLinkVotes: () =>
    api.get('/votes/web-links/votes/me'),

  getWebLinkLocation: (linkId) =>
    api.get(`/votes/web-links/${linkId}/location`),
};

// Moderation endpoints (Phase 16a)
export const moderationAPI = {
  // Flag an edge as spam/vandalism (hides after 10 flags)
  flagEdge: (edgeId, reason = 'spam') =>
    api.post('/moderation/flag', { edgeId, reason }),

  // Remove the current user's flag from an edge
  unflagEdge: (edgeId) =>
    api.post('/moderation/unflag', { edgeId }),

  // Get hidden children for a parent in context
  getHiddenChildren: (parentId, path = []) =>
    api.get(`/moderation/hidden/${parentId}`, { params: { path: path.join(',') } }),

  // Vote to hide or show a hidden concept
  voteModerationHide: (edgeId, voteType) =>
    api.post('/moderation/vote', { edgeId, voteType }),

  // Remove a moderation vote
  removeModerationVote: (edgeId) =>
    api.post('/moderation/vote/remove', { edgeId }),

  // Add a moderation comment
  addModerationComment: (edgeId, body) =>
    api.post('/moderation/comment', { edgeId, body }),

  // Get moderation comments for an edge
  getModerationComments: (edgeId) =>
    api.get(`/moderation/comments/${edgeId}`),

  // Admin: unhide an edge
  unhideEdge: (edgeId) =>
    api.post('/moderation/unhide', { edgeId }),
};

// Phase 30g: Informational page comments
export const pagesAPI = {
  getComments: (slug) =>
    api.get(`/pages/${slug}/comments`),

  addComment: (slug, body, parentCommentId) =>
    api.post(`/pages/${slug}/comments`, { body, ...(parentCommentId ? { parentCommentId } : {}) }),

  toggleCommentVote: (commentId) =>
    api.post(`/pages/comments/${commentId}/vote`),
};

// Phase 39a: Combos
export const combosAPI = {
  listCombos: (search, sort) =>
    api.get('/combos', { params: { search, sort } }),

  getCombo: (id) =>
    api.get(`/combos/${id}`),

  getComboLinks: (id, sort) =>
    api.get(`/combos/${id}/links`, { params: sort ? { sort } : {} }),

  createCombo: (name, description) =>
    api.post('/combos/create', { name, description }),

  getMyCombos: () =>
    api.get('/combos/mine'),

  getSubscriptions: () =>
    api.get('/combos/subscriptions'),

  subscribe: (comboId) =>
    api.post('/combos/subscribe', { comboId }),

  unsubscribe: (comboId) =>
    api.post('/combos/unsubscribe', { comboId }),

  addEdge: (comboId, edgeId) =>
    api.post(`/combos/${comboId}/edges/add`, { edgeId }),

  removeEdge: (comboId, edgeId) =>
    api.post(`/combos/${comboId}/edges/remove`, { edgeId }),

  transferOwnership: (comboId, newOwnerId) =>
    api.post(`/combos/${comboId}/transfer-ownership`, { newOwnerId }),

  getCombosByEdge: (edgeId) =>
    api.get(`/combos/by-edge/${edgeId}`),
};

// Phase 43a: Tunnel Links
export const tunnelsAPI = {
  getTunnelLinks: (edgeId, sort = 'votes') =>
    api.get(`/tunnels/${edgeId}?sort=${sort}`),

  createTunnelLink: (originEdgeId, linkedEdgeId, comment) =>
    api.post('/tunnels/create', { originEdgeId, linkedEdgeId, comment: comment || '' }),

  toggleTunnelVote: (tunnelLinkId) =>
    api.post('/tunnels/vote', { tunnelLinkId }),

  addTunnelLinkAddendum: (tunnelLinkId, body) =>
    api.post(`/tunnels/${tunnelLinkId}/addenda`, { body }),

  getTunnelLocation: (tunnelLinkId) =>
    api.get(`/tunnels/${tunnelLinkId}/location`),
};

// Phase 41a: Users endpoints
export const usersAPI = {
  getUserProfile: (userId) =>
    api.get(`/users/${userId}/profile`),
  searchUsers: (query) =>
    api.get(`/users/search?q=${encodeURIComponent(query)}`),
  // Phase 52b+c
  exportMyData: () =>
    api.get('/users/me/export', { responseType: 'blob' }),
  getExportStatus: () =>
    api.get('/users/me/export-status'),
  updateProfile: (updates) =>
    api.patch('/users/me', updates),
};

export const legalAPI = {
  submitInfringement: (data) =>
    api.post('/legal/infringement', data),
  submitCounterNotice: (data) =>
    api.post('/legal/counter-notice', data),
};

export const adminAPI = {
  getNotices: () =>
    api.get('/admin/legal/notices'),
  getCounterNotices: () =>
    api.get('/admin/legal/counter-notices'),
  getRemovals: () =>
    api.get('/admin/legal/removals'),
  legalRemove: (data) =>
    api.post('/admin/legal-removal', data),
  markNotified: (removalId) =>
    api.post(`/admin/legal/removals/${removalId}/mark-notified`),
  getRepeatInfringers: () =>
    api.get('/admin/legal/repeat-infringers'),
  clearStrike: (strikeId, reason) =>
    api.post(`/admin/legal/strikes/${strikeId}/clear`, { reason }),
};

// Phase 65b: Mentions
export const mentionsAPI = {
  getMentions: (targetType, targetId, { path, limit, offset } = {}) => {
    const params = {};
    if (path != null) params.path = path;
    if (limit != null) params.limit = limit;
    if (offset != null) params.offset = offset;
    return api.get(`/mentions/${targetType}/${targetId}`, { params });
  },
};

export default api;
