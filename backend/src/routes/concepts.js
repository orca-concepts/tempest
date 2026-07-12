const express = require('express');
const router = express.Router();
const conceptsController = require('../controllers/conceptsController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { rootConceptCreateLimiter, childConceptCreateLimiter } = require('../utils/userRateLimiter');

// GET routes use optionalAuth — guests can browse read-only
// POST routes use authenticateToken — must be logged in to create

router.get('/root', optionalAuth, conceptsController.getRootConcepts);
router.get('/attributes', optionalAuth, conceptsController.getAttributes);
router.get('/search', optionalAuth, conceptsController.searchConcepts);
router.get('/names/batch', optionalAuth, conceptsController.getConceptNames);
router.get('/:id/parents', optionalAuth, conceptsController.getConceptParents);
router.get('/:id/votesets', optionalAuth, conceptsController.getVoteSets);
router.get('/:id/subtree', optionalAuth, conceptsController.getSubtree);
router.get('/:id', optionalAuth, conceptsController.getConceptWithChildren);

// Phase 14a: Batch children for diff modal (guest-accessible)
router.post('/batch-children-for-diff', optionalAuth, conceptsController.getBatchChildrenForDiff);

// Create root concept (requires login)
router.post('/root', authenticateToken, rootConceptCreateLimiter, conceptsController.createRootConcept);

// Create child concept (requires login)
router.post('/child', authenticateToken, childConceptCreateLimiter, conceptsController.createChildConcept);

// Copy selected sibling questions' subtrees under another sibling (requires login)
router.post('/nest-under-sibling', authenticateToken, conceptsController.nestUnderSibling);

module.exports = router;
