const express = require('express');
const router = express.Router();
const communitiesController = require('../controllers/communitiesController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');

// GET routes use optionalAuth — guests can browse read-only.
// POST requires login.
router.get('/', optionalAuth, communitiesController.listCommunities);
router.get('/:slug', optionalAuth, communitiesController.getCommunityBySlug);
router.post('/', authenticateToken, communitiesController.createCommunity);

module.exports = router;
