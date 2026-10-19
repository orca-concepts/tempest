const express = require('express');
const router = express.Router();
const communitiesController = require('../controllers/communitiesController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');

// GET routes use optionalAuth — guests can browse read-only.
// POST requires login.
router.get('/', optionalAuth, communitiesController.listCommunities);
// Owner management (Phase 72a) — registered before the `/:slug` catch-all GET is
// irrelevant (these are POST), but kept grouped for clarity.
router.post('/:id/owners/add', authenticateToken, communitiesController.addOwner);
router.post('/:id/owners/remove', authenticateToken, communitiesController.removeOwner);
router.get('/:slug', optionalAuth, communitiesController.getCommunityBySlug);
router.post('/', authenticateToken, communitiesController.createCommunity);

module.exports = router;
