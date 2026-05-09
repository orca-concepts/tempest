const express = require('express');
const router = express.Router();
const votesController = require('../controllers/votesController');
const authenticateToken = require('../middleware/auth');
const { webLinkAddLimiter } = require('../utils/userRateLimiter');

// optionalAuth: same as authenticateToken but doesn't reject if no token
const jwt = require('jsonwebtoken');
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { userId: decoded.userId, username: decoded.username };
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
};

// Web Links (Phase 6) — GET is guest-accessible, write ops require auth
router.get('/web-links/by-url', optionalAuth, votesController.getWebLinksByUrl); // Phase 58b-2: cross-concept URL search
router.get('/web-links/all/:conceptId', optionalAuth, votesController.getAllWebLinksForConcept);
router.get('/web-links/:edgeId', optionalAuth, votesController.getWebLinks);
router.post('/web-links/add', authenticateToken, webLinkAddLimiter, votesController.addWebLink);
router.post('/web-links/remove', authenticateToken, votesController.removeWebLink);
router.post('/web-links/upvote', authenticateToken, votesController.upvoteWebLink);
router.post('/web-links/unvote', authenticateToken, votesController.removeWebLinkVote);
router.put('/web-links/:linkId/comment', authenticateToken, votesController.updateConceptLinkComment);
router.get('/web-links/votes/me', authenticateToken, votesController.getMyLinkVotes); // Phase 58d-2

// All remaining vote routes require authentication
router.use(authenticateToken);

// Get user's saved edges (for Saved Page)
router.get('/saved', votesController.getUserSaves);

// Saved Tabs CRUD
router.get('/tabs', votesController.getUserTabs);
router.post('/tabs/create', votesController.createTab);
router.post('/tabs/rename', votesController.renameTab);
router.post('/tabs/delete', votesController.deleteTab);

// Graph Tabs CRUD (Phase 5c)
router.get('/graph-tabs', votesController.getGraphTabs);
router.post('/graph-tabs/create', votesController.createGraphTab);
router.post('/graph-tabs/update', votesController.updateGraphTab);
router.post('/graph-tabs/close', votesController.closeGraphTab);

// Tab Groups CRUD (Phase 5d)
router.get('/tab-groups', votesController.getTabGroups);
router.post('/tab-groups/create', votesController.createTabGroup);
router.post('/tab-groups/rename', votesController.renameTabGroup);
router.post('/tab-groups/delete', votesController.deleteTabGroup);
router.post('/tab-groups/toggle', votesController.toggleTabGroup);
router.post('/tab-groups/add-tab', votesController.addTabToGroup);
router.post('/tab-groups/remove-tab', votesController.removeTabFromGroup);

// Saved Tree Order (Phase 5e)
router.get('/tree-order', votesController.getTreeOrder);
router.post('/tree-order/update', votesController.updateTreeOrder);

// Child Rankings (Phase 5f)
router.get('/rankings', votesController.getChildRankings);
router.post('/rankings/update', votesController.updateChildRanking);
router.post('/rankings/remove', votesController.removeChildRanking);

// Saved Page Tab Activity / Dormancy (Phase 8 — retired, returns 410)
router.get('/tab-activity', votesController.getTabActivity);
router.post('/tab-activity/record', votesController.recordTabActivity);
router.post('/tab-activity/revive', votesController.reviveTabActivity);

// Save votes
router.post('/add', votesController.addVote);
router.post('/remove', votesController.removeVote);
router.post('/remove-from-tab', votesController.removeVoteFromTab);

// Vote Set Drift (Phase 23b — retired, returns 410)
router.get('/drift/:parentEdgeId', votesController.getVoteSetDrift);

// Link votes (similarity votes — Flip View only)
router.post('/link/add', votesController.addLinkVote);
router.post('/link/remove', votesController.removeLinkVote);

// Swap votes (replace votes)
router.get('/swap/:edgeId', votesController.getSwapVotes);
router.post('/swap/add', votesController.addSwapVote);
router.post('/swap/remove', votesController.removeSwapVote);

// Sidebar Items (Phase 19b)
router.get('/sidebar-items', votesController.getSidebarItems);
router.post('/sidebar-items/reorder', votesController.reorderSidebarItems);

module.exports = router;
