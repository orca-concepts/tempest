const express = require('express');
const router = express.Router();
const conceptsController = require('../controllers/conceptsController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { rootConceptCreateLimiter, childConceptCreateLimiter } = require('../utils/userRateLimiter');

// GET routes use optionalAuth — guests can browse read-only
// POST routes use authenticateToken — must be logged in to create

router.get('/root', optionalAuth, conceptsController.getRootConcepts);
// Phase 72d: graph view (guest-accessible). Registered before `/:id` so the
// literal `/graph` path isn't captured by the id param.
router.get('/graph', optionalAuth, conceptsController.getGraph);
router.get('/attributes', optionalAuth, conceptsController.getAttributes);
router.get('/search', optionalAuth, conceptsController.searchConcepts);
router.get('/names/batch', optionalAuth, conceptsController.getConceptNames);
router.get('/:id/parents', optionalAuth, conceptsController.getConceptParents);
router.get('/:id/votesets', optionalAuth, conceptsController.getVoteSets);
router.get('/:id/subtree', optionalAuth, conceptsController.getSubtree);
router.get('/:id/bridges', optionalAuth, conceptsController.getConceptBridges);
router.get('/:id', optionalAuth, conceptsController.getConceptWithChildren);

// Phase 14a: Batch children for diff modal (guest-accessible)
router.post('/batch-children-for-diff', optionalAuth, conceptsController.getBatchChildrenForDiff);

// Create root concept (requires login)
router.post('/root', authenticateToken, rootConceptCreateLimiter, conceptsController.createRootConcept);

// Create child concept (requires login)
router.post('/child', authenticateToken, childConceptCreateLimiter, conceptsController.createChildConcept);

// Copy selected sibling questions' subtrees under another sibling (requires login)
router.post('/nest-under-sibling', authenticateToken, conceptsController.nestUnderSibling);

// Phase 72c-1: curated edit mode — rename a question, soft-delete an edge+subtree.
// Both are curated-owner-only (gated in the controller via communityAccess).
router.post('/edges/:edgeId/delete', authenticateToken, conceptsController.softDeleteEdge);

// Phase 72c-2: precedent/subsequent links between sibling questions (curated,
// owner-only, gated in the controller). Registered before the `/:id/*` routes so
// the literal path isn't captured by the id param.
router.post('/sequence-links/add', authenticateToken, conceptsController.addSequenceLink);
router.post('/sequence-links/remove', authenticateToken, conceptsController.removeSequenceLink);

router.post('/:id/rename', authenticateToken, conceptsController.renameConcept);

module.exports = router;
