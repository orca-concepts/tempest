import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { conceptsAPI, votesAPI, moderationAPI, combosAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConceptGrid from '../components/ConceptGrid';
import AddConceptModal from '../components/AddConceptModal';
import Breadcrumb from '../components/Breadcrumb';
import SearchField from '../components/SearchField';
import SwapModal from '../components/SwapModal';
import VoteSetBar from '../components/VoteSetBar';
import CardLinksSection from '../components/CardLinksSection';
import CardAnswerSection from '../components/CardAnswerSection';
import HiddenConceptsView from '../components/HiddenConceptsView';
import NewQuestionCard from '../components/NewQuestionCard';
import EditableField from '../components/EditableField';
import PageFeedbackLauncher from '../components/PageFeedbackLauncher';
import RestructureBar from '../components/RestructureBar';

import TunnelView from '../components/TunnelView';

const Concept = ({
  // Props when running inside AppShell (graph tab mode)
  graphTabId,
  initialConceptId,
  initialPath,
  initialViewMode,
  onNavigate,
  isGuest = false,
  onOpenConceptTab,
  onRequestLogin,
  ownedCombos = [],
  onComboEdgeAdded,
  pendingScrollLinkId,
  onPendingScrollLinkConsumed,
  pendingScrollTunnelLinkId,
  onPendingScrollTunnelLinkConsumed,
  editMode = false,
  onToggleEditMode,
  onConceptRenamed,
  renamedConcept,
  onOpenGraph,
  onOpenVotes,
  // Phase 73: reload graph tabs after a restructure (their paths may have moved).
  onStructureChanged,
  // Phase 72e-2: inbox navigation can request a card's or this page's feedback panel.
  pendingFeedback = null,
  onPendingFeedbackConsumed,
}) => {
  // Determine if we're in "tab mode" (inside AppShell) or "standalone mode" (URL-routed)
  const isTabMode = !!graphTabId;

  // URL-based params (standalone mode only)
  const urlParams = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // The concept ID to load — from props (tab mode) or URL (standalone)
  const conceptId = isTabMode ? initialConceptId : urlParams.id;

  // Internal navigation state for tab mode
  const [tabConceptId, setTabConceptId] = useState(initialConceptId);
  const [tabPath, setTabPath] = useState(initialPath || []);
  const [tabViewMode, setTabViewMode] = useState(initialViewMode || 'children');

  // The effective concept ID and path (respects tab mode vs standalone)
  const effectiveConceptId = isTabMode ? tabConceptId : urlParams.id;
  const effectivePath = isTabMode
    ? tabPath
    : (searchParams.get('path') || '').split(',').filter(Boolean).map(Number);
  // Flip View is retired: any legacy 'flip' value (stored tab or pasted URL) falls
  // back to the normal children view. Only 'children' and 'tunnel' remain.
  const effectiveViewMode = (isTabMode
    ? tabViewMode
    : (searchParams.get('view') === 'tunnel' ? 'tunnel' : 'children')) === 'tunnel'
    ? 'tunnel'
    : 'children';

  const [concept, setConcept] = useState(null);
  // Phase 72a: owning community's mode + the caller's ownership, from the
  // GET /concepts/:id response. Drive the write/vote affordance gating below.
  const [communityMode, setCommunityMode] = useState('open');
  const [isCommunityOwner, setIsCommunityOwner] = useState(false);
  const [bridges, setBridges] = useState([]);
  const [children, setChildren] = useState([]);
  const [path, setPath] = useState([]);
  const [currentEdgeVoteCount, setCurrentEdgeVoteCount] = useState(null);
  const [currentAttribute, setCurrentAttribute] = useState(null);
  // Phase 72f: the current question's own edge id and (curated) its own answers,
  // for the own-page answer/link section rendered under the question title.
  const [currentEdgeId, setCurrentEdgeId] = useState(null);
  // Phase 73 follow-up: the current edge is soft-deleted (opened from an old tab).
  const [currentEdgeDeleted, setCurrentEdgeDeleted] = useState(false);
  const [currentAnswers, setCurrentAnswers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortMode, setSortMode] = useState('saves'); // 'saves' | 'new'
  
  // Vote set state
  const [voteSets, setVoteSets] = useState([]);
  const [edgeToSets, setEdgeToSets] = useState({});
  const [activeSetIndices, setActiveSetIndices] = useState([]);
  const [tieredView, setTieredView] = useState(false);

  // User's own vote set index (Phase 5f)
  const [userSetIndex, setUserSetIndex] = useState(null);

  // Parent edge ID for ranking context (Phase 5f)
  const [parentEdgeId, setParentEdgeId] = useState(null);

  // Phase 69: altParentCount drives the edit-mode "also appears under N" note;
  // tunnelLinkCount is used by the (retired) tunnel view.
  const [altParentCount, setAltParentCount] = useState(0);
  const [tunnelLinkCount, setTunnelLinkCount] = useState(0);

  // Swap modal state
  const [swapModalEdge, setSwapModalEdge] = useState(null);

  // Share link state
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  // Nest-under-sibling state
  const [nestMode, setNestMode] = useState(false);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState(() => new Set());
  const [nestTargetEdgeId, setNestTargetEdgeId] = useState(null);
  const [nestPickerOpen, setNestPickerOpen] = useState(false);
  const [nestSubmitting, setNestSubmitting] = useState(false);
  const [nestFeedback, setNestFeedback] = useState(null);

  // Phase 16c: Hidden concepts state
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

  // Phase 72c-1: curated edit mode
  const [showNewCard, setShowNewCard] = useState(false);

  // Phase 73: curated restructure selection + ungroup target.
  const [restructureSel, setRestructureSel] = useState(() => new Set());
  const [ungroupConcept, setUngroupConcept] = useState(null);
  
  // Phase 39d: Add to Combo picker
  const [showComboPicker, setShowComboPicker] = useState(false);
  const [comboFeedback, setComboFeedback] = useState(null); // null, 'added', 'duplicate', or error string
  const comboPickerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    loadConcept();
  }, [effectiveConceptId, effectivePath.join(','), sortMode, effectiveViewMode]);

  // Sync internal state if AppShell navigates this tab externally
  // (e.g. search result clicked, or browser back/forward via popstate)
  const initialPathKey = (initialPath || []).join(',');
  useEffect(() => {
    if (!isTabMode) return;
    const conceptChanged = initialConceptId !== tabConceptId;
    const pathChanged = (initialPath || []).join(',') !== tabPath.join(',');
    const viewModeChanged = (initialViewMode || 'children') !== tabViewMode;
    if (conceptChanged || pathChanged || viewModeChanged) {
      setTabConceptId(initialConceptId);
      setTabPath(initialPath || []);
      setTabViewMode(initialViewMode || 'children');
    }
  }, [initialConceptId, initialPathKey, initialViewMode]);

  // `opts.silent` skips the full-page loading flash. The loading flash makes
  // Concept hit its `if (loading) return <Loading/>` early return, which unmounts
  // the whole subtree — including ConceptGrid and any open FeedbackPanel. The
  // feedback panel refreshes data through a silent reload so it stays mounted
  // (Phase 72e-1 fix); its own list re-fetches in place.
  const loadConcept = async (opts = {}) => {
    const silent = !!opts.silent;
    try {
      if (!silent) setLoading(true);
      setParentEdgeId(null);
      const pathParam = effectivePath.join(',');
      const sortParam = sortMode === 'saves' ? undefined : sortMode;
      const response = await conceptsAPI.getConceptWithChildren(
        effectiveConceptId, pathParam, sortParam
      );
      
      setConcept(response.data.concept);
      setCommunityMode(response.data.communityMode || 'open');
      setIsCommunityOwner(!!response.data.isCommunityOwner);
      setChildren(response.data.children);
      setPath(response.data.path);
      setCurrentEdgeVoteCount(response.data.currentEdgeVoteCount);
      setCurrentAttribute(response.data.currentAttribute || null);
      setCurrentEdgeId(response.data.currentEdgeId || null);
      setCurrentEdgeDeleted(!!response.data.currentEdgeDeleted);
      setCurrentAnswers(response.data.currentAnswers || null);
      setAltParentCount(response.data.altParentCount || 0);
      setTunnelLinkCount(response.data.tunnelLinkCount || 0);
      setError(null);

      // Phase 71: cross-community exact-name bridges for this concept
      conceptsAPI.getConceptBridges(effectiveConceptId)
        .then((br) => setBridges(br.data.bridges || []))
        .catch(() => setBridges([]));

      // Load vote sets + hidden children count for the children/tunnel views.
      await loadVoteSets(pathParam);
      // Phase 16c: Load hidden children count
      loadHiddenCount();
    } catch (err) {
      setError('Failed to load concept');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Phase 72e-1: a feedback action refreshes the card's open count without the
  // loading flash, so the open FeedbackPanel is not unmounted.
  const refreshFeedbackCounts = () => loadConcept({ silent: true });

  // Phase 71: open the matched question in another community.
  const handleBridgeClick = (bridge) => {
    if (!onOpenConceptTab) return;
    onOpenConceptTab(
      bridge.conceptId,
      [],
      undefined,
      undefined,
      undefined,
      'children'
    );
  };

  const loadVoteSets = async (pathParam) => {
    try {
      const response = await conceptsAPI.getVoteSets(effectiveConceptId, pathParam);
      setVoteSets(response.data.voteSets || []);
      setEdgeToSets(response.data.edgeToSets || {});
      setUserSetIndex(response.data.userSetIndex != null ? response.data.userSetIndex : null);
      setParentEdgeId(response.data.parentEdgeId || null);
      setActiveSetIndices([]);
      setTieredView(false);
    } catch (err) {
      console.error('Failed to load vote sets:', err);
      setVoteSets([]);
      setEdgeToSets({});
      setUserSetIndex(null);
      setParentEdgeId(null);
    }
  };

  // Phase 16c: Load count of hidden children for the badge
  const loadHiddenCount = async () => {
    if (!user) { setHiddenCount(0); return; }
    try {
      const response = await moderationAPI.getHiddenChildren(effectiveConceptId, effectivePath);
      setHiddenCount((response.data.hiddenChildren || []).length);
    } catch (err) {
      // Silently fail — badge just won't show
      setHiddenCount(0);
    }
  };

  // Phase 65a: Read URL fragment (#link-:id / #tunnel-:id) after concept loads
  useEffect(() => {
    if (!concept) return;
    const hash = window.location.hash;
    if (!hash) return;

    const linkFragMatch = hash.match(/^#link-(\d+)$/);
    const tunnelFragMatch = hash.match(/^#tunnel-(\d+)$/);

    if (linkFragMatch) {
      // No view mode change — the own-page links/answers section handles /link.
    } else if (tunnelFragMatch) {
      // View mode switch is handled upstream by handleOpenConceptTab's
      // viewMode arg; this branch is retained for manually-pasted fragment URLs.
    }

    // Clear the fragment so it doesn't retrigger on rerender.
    navigate(window.location.pathname + window.location.search, { replace: true });
  }, [concept?.id]);

  // Phase 72f: curated deep link (/link/:id) — the answer renders in the question's
  // own-page answer section under the title (or inside a child card if the answer
  // is on a child). Scroll to and highlight the answer row. Open communities are
  // handled by the own-page CardLinksSection, which consumes pendingScrollLinkId.
  useEffect(() => {
    if (communityMode !== 'curated' || effectiveViewMode !== 'children') return;
    if (!pendingScrollLinkId || loading) return;
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector(`#answer-${pendingScrollLinkId}`);
    if (!el) return;
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.backgroundColor = '#fffbcc';
      setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
      if (onPendingScrollLinkConsumed) onPendingScrollLinkConsumed();
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingScrollLinkId, loading, children, currentAnswers, communityMode, effectiveViewMode]);

  // ─── Navigation helpers ──────────────────────────────────

  // Navigate within this tab to a new concept
  const navigateInTab = (newConceptId, newPath, newViewMode) => {
    if (isTabMode) {
      setTabConceptId(newConceptId);
      setTabPath(newPath);
      setTabViewMode(newViewMode || 'children');

      if (onNavigate && graphTabId) {
        onNavigate(graphTabId, {
          tabType: 'concept',
          conceptId: newConceptId,
          path: newPath,
          viewMode: newViewMode || 'children',
          // label will be updated again once concept loads; omit here to avoid flash of wrong name
        });
      }
    } else {
      const pathStr = newPath.join(',');
      const viewParam = newViewMode === 'tunnel' ? '&view=tunnel' : '';
      navigate(`/concept/${newConceptId}?path=${pathStr}${viewParam}`);
    }
  };

  const navigateToRoot = () => {
    if (isTabMode) {
      setTabConceptId(null);
      setTabPath([]);
      setTabViewMode('children');
      if (onNavigate && graphTabId) {
        onNavigate(graphTabId, {
          tabType: 'root',
          conceptId: null,
          path: [],
          viewMode: 'children',
          label: 'Root',
        });
      }
    } else {
      navigate('/');
    }
  };

  // Update tab label when concept loads
  useEffect(() => {
    if (isTabMode && concept && onNavigate && graphTabId) {
      onNavigate(graphTabId, { label: concept.name });
    }
  }, [concept, currentAttribute]);

  // ─── Handlers (mostly unchanged from original) ──────────

  const handleConceptClick = (childId) => {
    navigateInTab(childId, path, 'children');
  };

  // Phase 69: jump to a deeper (cross-sibling) occurrence of a child. The nested
  // location's graph_path IS that occurrence's path-to-parent.
  const handleNavigateNested = (childId, nestedGraphPath) => {
    navigateInTab(childId, nestedGraphPath, 'children');
  };

  const handleAddConcept = async (name) => {
    try {
      const pathString = path.slice(0, -1).join(',');
      await conceptsAPI.createChildConcept(name, effectiveConceptId, pathString);
      await loadConcept();
      setShowAddModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create question');
    }
  };

  // Phase 72c-1: edit-mode handlers (curated owners). Reject on failure so inline
  // editors (EditableField / NewQuestionCard) surface the error in place.
  const handleRename = async (conceptId, newName) => {
    await conceptsAPI.renameConcept(conceptId, newName);
    await loadConcept();
    // Tab-mgmt fix 3: tell AppShell so other open tabs of this concept (and their
    // sidebar labels) refresh without a reload.
    if (onConceptRenamed) onConceptRenamed(conceptId, newName);
  };

  const handleDeleteEdge = async (edgeId) => {
    await conceptsAPI.softDeleteEdge(edgeId);
    await loadConcept();
  };

  const handleCreateChildInline = async (name) => {
    const pathString = path.slice(0, -1).join(',');
    await conceptsAPI.createChildConcept(name, effectiveConceptId, pathString);
    setShowNewCard(false);
    await loadConcept();
  };

  const handleVote = async (edgeId, hasVoted, childPath) => {
    try {
      if (hasVoted) {
        await votesAPI.removeVote(edgeId);
      } else {
        // Phase 20c: Saving — optimistically clear any swap vote for this edge in local state
        setChildren(prev => prev.map(c =>
          c.edge_id === edgeId
            ? { ...c, swap_count: Math.max(0, (c.swap_count || 1) - 1) }
            : c
        ));
        await votesAPI.addVote(edgeId, path);
      }
      await loadConcept();
    } catch (err) {
      console.error('Vote failed:', err);
      alert(err.response?.data?.error || 'Failed to vote');
    }
  };

  const handleBreadcrumbClick = (clickedIndex) => {
    if (clickedIndex === 0) {
      navigateToRoot();
    } else {
      const targetId = path[clickedIndex - 1];
      const newPath = path.slice(0, clickedIndex - 1);
      navigateInTab(targetId, newPath, 'children');
    }
  };

  const handleEnterTunnel = () => {
    navigateInTab(effectiveConceptId, effectivePath, 'tunnel');
  };

  // Callback for TunnelView to open a concept in a new graph tab
  const handleOpenNewTab = (newConceptId, newPath) => {
    if (onOpenConceptTab) {
      onOpenConceptTab(newConceptId, newPath || [], undefined, undefined, undefined, 'children');
    }
  };

  // Callback for TunnelView navigation (navigate current tab to a concept)
  const handleTunnelNavigate = (newConceptId, newPath, newViewMode) => {
    navigateInTab(newConceptId, newPath, newViewMode || 'children');
  };

  // Phase 72d: open the graph-view overlay scoped to this question's root graph,
  // with this question highlighted. `path` is root-to-current inclusive, so the
  // last element is the current concept and the rest is its graph_path.
  const handleOpenGraphView = () => {
    if (!onOpenGraph) return;
    const fullPath = path || [];
    const cid = fullPath.length ? fullPath[fullPath.length - 1] : Number(effectiveConceptId);
    const parentPath = fullPath.slice(0, -1);
    const root = fullPath.length ? fullPath[0] : cid;
    onOpenGraph(root, cid, parentPath);
  };

  const handleShareLink = async () => {
    const pathStr = (path || []).slice(0, -1).join(',');
    const url = `${window.location.origin}/concept/${effectiveConceptId}?path=${pathStr}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
    }
  };

  // Phase 39d: Add to Combo handler
  const handleAddToCombo = async (comboId) => {
    try {
      await combosAPI.addEdge(comboId, parentEdgeId);
      setShowComboPicker(false);
      setComboFeedback('added');
      setTimeout(() => setComboFeedback(null), 1500);
      if (onComboEdgeAdded) onComboEdgeAdded();
    } catch (err) {
      setShowComboPicker(false);
      if (err.response?.status === 409) {
        setComboFeedback('duplicate');
        setTimeout(() => setComboFeedback(null), 2000);
      } else {
        setComboFeedback(err.response?.data?.error || 'Failed to add');
        setTimeout(() => setComboFeedback(null), 2000);
      }
    }
  };

  // Phase 39d: Close combo picker on outside click / Escape
  useEffect(() => {
    if (!showComboPicker) return;
    const handleClick = (e) => {
      if (comboPickerRef.current && !comboPickerRef.current.contains(e.target)) {
        setShowComboPicker(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowComboPicker(false);
    };
    window.document.addEventListener('mousedown', handleClick);
    window.document.addEventListener('keydown', handleKey);
    return () => {
      window.document.removeEventListener('mousedown', handleClick);
      window.document.removeEventListener('keydown', handleKey);
    };
  }, [showComboPicker]);

  // Phase 39d: Reset combo picker/feedback on concept change
  useEffect(() => {
    setShowComboPicker(false);
    setComboFeedback(null);
  }, [effectiveConceptId, effectivePath?.join(',')]);

  // Phase 72c-1: close the inline new-question card whenever edit mode isn't active
  // (left edit mode, switched to tunnel view, lost ownership, or navigated).
  useEffect(() => {
    const canEdit = communityMode === 'curated' && isCommunityOwner && editMode && effectiveViewMode === 'children';
    if (!canEdit) setShowNewCard(false);
    // Phase 73: clear restructure selection on leaving edit mode or navigating.
    setRestructureSel(new Set());
    setUngroupConcept(null);
  }, [communityMode, isCommunityOwner, editMode, effectiveViewMode, effectiveConceptId, effectivePath?.join(',')]);

  // Tab-mgmt fix 3: when a concept is renamed (in this or any other tab), refresh
  // this tab if it shows that concept — as its own question, a breadcrumb
  // ancestor, or a visible child. loadConcept re-pulls child names and bridges too.
  useEffect(() => {
    if (!renamedConcept) return;
    const cid = Number(renamedConcept.conceptId);
    const shows =
      Number(effectiveConceptId) === cid ||
      (path || []).some((id) => Number(id) === cid) ||
      children.some((ch) => Number(ch.id) === cid);
    if (shows) loadConcept();
  }, [renamedConcept]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConceptAdded = () => {
    loadConcept();
  };

  const handleSwapClick = (childConcept) => {
    setSwapModalEdge({
      edgeId: childConcept.edge_id,
      conceptName: childConcept.name,
      conceptId: childConcept.id,
    });
  };

  const handleSwapModalClose = () => setSwapModalEdge(null);
  const handleSwapVoteChanged = () => {
    // Phase 20c: Swap vote added — optimistically clear any save for this edge in local state
    if (swapModalEdge) {
      const eid = swapModalEdge.edgeId;
      setChildren(prev => prev.map(c =>
        c.edge_id === eid
          ? {
              ...c,
              user_voted: false,
              vote_count: c.user_voted ? Math.max(0, (parseInt(c.vote_count) || 1) - 1) : (parseInt(c.vote_count) || 0),
            }
          : c
      ));
    }
    loadConcept();
  };

  // Nest-under-sibling: enter selection mode from a right-clicked child card.
  const handleNestUnderSibling = (child) => {
    setNestMode(true);
    setSelectedEdgeIds(new Set([child.edge_id]));
    setNestTargetEdgeId(null);
    setNestPickerOpen(false);
    setNestFeedback(null);
  };

  const toggleNestSelect = (edgeId) => {
    setSelectedEdgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) next.delete(edgeId); else next.add(edgeId);
      return next;
    });
    // If the newly-selected edge was the chosen target, clear the target.
    setNestTargetEdgeId((prev) => (prev === edgeId ? null : prev));
  };

  const cancelNest = () => {
    setNestMode(false);
    setSelectedEdgeIds(new Set());
    setNestTargetEdgeId(null);
    setNestPickerOpen(false);
    setNestSubmitting(false);
    setNestFeedback(null);
  };

  const confirmNest = async () => {
    if (nestSubmitting) return;
    if (selectedEdgeIds.size === 0 || !nestTargetEdgeId) return;
    setNestSubmitting(true);
    setNestFeedback(null);
    try {
      const res = await conceptsAPI.nestUnderSibling({
        parentConceptId: effectiveConceptId,
        path,
        selectedEdgeIds: [...selectedEdgeIds],
        targetEdgeId: nestTargetEdgeId,
      });
      cancelNest();
      await loadConcept();
      const c = res?.data || {};
      setNestFeedback(`Nested ${c.copiedEdges ?? ''} question${c.copiedEdges === 1 ? '' : 's'} under ${c.target?.name || 'the selected question'}.`);
      setTimeout(() => setNestFeedback(null), 4000);
    } catch (err) {
      setNestSubmitting(false);
      setNestFeedback(err?.response?.data?.error || 'Could not nest the selected questions.');
    }
  };

  // Phase 73: curated restructure (group / move into / ungroup).
  const toggleRestructureSelect = (edgeId) => {
    setRestructureSel((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) next.delete(edgeId); else next.add(edgeId);
      return next;
    });
    setUngroupConcept(null);
  };
  const clearRestructureSelection = () => setRestructureSel(new Set());
  const handleUngroup = (child) => { setRestructureSel(new Set()); setUngroupConcept(child); };
  const highlightCard = (edgeId) => {
    if (edgeId == null) return;
    const el = document.getElementById(`qcard-${edgeId}`);
    if (!el) return;
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = el.style.backgroundColor;
      el.style.backgroundColor = '#fffbcc';
      setTimeout(() => { el.style.backgroundColor = prev || ''; }, 2000);
    }, 300);
  };
  const handleRestructureDone = async ({ highlightEdgeId } = {}) => {
    setRestructureSel(new Set());
    setUngroupConcept(null);
    await loadConcept();
    if (onStructureChanged) onStructureChanged();
    highlightCard(highlightEdgeId);
  };

  // Phase 16c: Flag a child concept as spam
  const handleFlag = async (child) => {
    if (!user) return;
    const confirmMsg = `Flag "${child.name}" as spam?\n\nOnce 10 users have flagged it, it will be hidden from all users. It can be reviewed and restored from the Hidden panel.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await moderationAPI.flagEdge(child.edge_id, 'spam');
      await loadConcept();
      await loadHiddenCount();
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.error?.includes('already flagged')) {
        alert('You have already flagged this question.');
      } else {
        alert(err.response?.data?.error || 'Failed to flag question');
      }
    }
  };

  const handleUnflag = async (child) => {
    if (!user) return;
    try {
      await moderationAPI.unflagEdge(child.edge_id);
      await loadConcept();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove flag');
    }
  };

  // --- Vote set filtering ---
  const handleSetClick = (setIndex) => {
    if (setIndex === null) {
      setActiveSetIndices([]);
      setTieredView(false);
      return;
    }
    setActiveSetIndices(prev => {
      const next = prev.includes(setIndex)
        ? prev.filter(i => i !== setIndex)
        : [...prev, setIndex];
      if (next.length < 2) setTieredView(false);
      return next;
    });
  };

  const handleTieredToggle = () => setTieredView(prev => !prev);

  const getEffectiveActiveSetIndices = () => {
    return activeSetIndices;
  };

  const getFilteredChildren = () => {
    const effectiveIndices = getEffectiveActiveSetIndices();
    if (effectiveIndices.length === 0) return children;
    const filtered = children.filter(child => {
      const childSets = edgeToSets[child.edge_id] || [];
      return childSets.some(setIdx => effectiveIndices.includes(setIdx));
    });
    return [...filtered].sort((a, b) => {
      const aSets = (edgeToSets[a.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      const bSets = (edgeToSets[b.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      if (bSets !== aSets) return bSets - aSets;
      return (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0);
    });
  };

  const getTieredSections = () => {
    const effectiveIndices = getEffectiveActiveSetIndices();
    if (effectiveIndices.length < 2) return null;
    const totalSelected = effectiveIndices.length;
    const filtered = children.filter(child => {
      const childSets = edgeToSets[child.edge_id] || [];
      return childSets.some(setIdx => effectiveIndices.includes(setIdx));
    });
    const byMatchCount = {};
    filtered.forEach(child => {
      const matchCount = (edgeToSets[child.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      if (!byMatchCount[matchCount]) byMatchCount[matchCount] = [];
      byMatchCount[matchCount].push(child);
    });
    Object.values(byMatchCount).forEach(group => {
      group.sort((a, b) => (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0));
    });
    const sections = [];
    for (let count = totalSelected; count >= 1; count--) {
      if (byMatchCount[count] && byMatchCount[count].length > 0) {
        let label = count === totalSelected
          ? `In all ${totalSelected} selected patterns`
          : `In ${count} of ${totalSelected}`;
        sections.push({ label, matchCount: count, children: byMatchCount[count] });
      }
    }
    return sections;
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (error || !concept) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error || 'Question not found'}</div>
      </div>
    );
  }

  const searchPath = path.slice(0, -1).join(',');

  // Phase 72a: curated communities are owner-write-only and have no voting.
  const votingAllowed = communityMode !== 'curated';
  const canCreate = communityMode === 'curated' ? isCommunityOwner : !isGuest;

  // Phase 72c-1: curated edit mode (owners only), only in children view.
  const canEditMode = communityMode === 'curated' && isCommunityOwner;
  const editing = canEditMode && editMode && effectiveViewMode === 'children';

  // Phase 72f: the side links panel is gone from children view in BOTH modes
  // (curated → in-card answers since 72b; open → in-card link section now). The
  // question's own links/answers render under its title instead.
  const openChildrenView = communityMode !== 'curated' && effectiveViewMode === 'children';

  // Phase 72e-2: inbox navigation can target a child card's feedback panel, or
  // this question's own page branch panel (pageEdgeId === this page's edge).
  const autoOpenCardEdgeId = pendingFeedback && pendingFeedback.cardEdgeId != null ? pendingFeedback.cardEdgeId : null;
  const autoOpenPagePanel = !!(pendingFeedback && Object.prototype.hasOwnProperty.call(pendingFeedback, 'pageEdgeId')
    && pendingFeedback.pageEdgeId != null && pendingFeedback.pageEdgeId === parentEdgeId);

  const effectiveIndices = getEffectiveActiveSetIndices();
  const hasActiveFilters = effectiveIndices.length > 0;
  const displayChildren = getFilteredChildren();
  const tieredSections = (tieredView && effectiveIndices.length >= 2) ? getTieredSections() : null;
  const filteredCount = hasActiveFilters ? displayChildren.length : children.length;
  const totalActiveFilterCount = activeSetIndices.length;

  return (
    <div style={styles.container} ref={containerRef}>
      {/* Breadcrumb / header area (no app-level header — that's in AppShell) */}
      <div style={styles.headerBar}>
        <div style={styles.headerContent}>
          <div style={styles.breadcrumbWithBack}>
            <Breadcrumb
              path={path}
              currentConcept={concept}
              currentAttribute={currentAttribute}
              onBreadcrumbClick={handleBreadcrumbClick}
            />
          </div>
          <div style={styles.buttonSection}>
            {canEditMode && effectiveViewMode === 'children' && (
              <button
                onClick={onToggleEditMode}
                style={editMode ? styles.editToggleActive : styles.editToggle}
                title={editMode ? 'Return to reader view' : 'Edit this community'}
              >{editMode ? 'Done' : 'Edit'}</button>
            )}
            <button
              onClick={handleOpenGraphView}
              style={styles.shareButton}
              title="Open the whole graph as a collapsible tree"
            >
              Graph
            </button>
            {votingAllowed && user && !isGuest && onOpenVotes && (
              <button
                onClick={onOpenVotes}
                style={styles.shareButton}
                title="View your saved questions and upvoted links"
              >
                Votes
              </button>
            )}
            <div style={styles.shareButtonWrapper}>
              <button
                onClick={handleShareLink}
                style={styles.shareButton}
                title="Copy shareable link to clipboard"
              >
                {shareLinkCopied ? 'Copied!' : 'Share'}
              </button>
            </div>
            {user && !isGuest && parentEdgeId && ownedCombos.length > 0 && (
              <div style={{ position: 'relative' }} ref={comboPickerRef}>
                <button
                  onClick={() => {
                    if (comboFeedback) return;
                    if (ownedCombos.length === 1) {
                      handleAddToCombo(ownedCombos[0].id);
                    } else {
                      setShowComboPicker(prev => !prev);
                    }
                  }}
                  style={styles.annotateButton}
                  title="Add this question to a situation"
                >
                  {comboFeedback === 'added' ? 'Added \u2713'
                    : comboFeedback === 'duplicate' ? 'Already in situation'
                    : comboFeedback ? comboFeedback
                    : 'Add to Situation'}
                </button>
                {showComboPicker && (
                  <div style={styles.comboPickerDropdown}>
                    {ownedCombos.map(combo => (
                      <div
                        key={combo.id}
                        style={styles.comboPickerItem}
                        onClick={() => handleAddToCombo(combo.id)}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f4f0'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <span style={styles.comboPickerName}>{combo.name}</span>
                        <span style={styles.comboPickerMeta}>{combo.edge_count || 0} question{combo.edge_count != 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <main style={(editing && (restructureSel.size > 0 || ungroupConcept)) ? { ...styles.main, paddingBottom: '260px' } : styles.main}>
        <div style={effectiveConceptId ? { width: '100%' } : undefined}>
            {effectiveViewMode === 'children' ? (
              <>
                <div style={styles.conceptHeader}>
                  <h2 style={styles.conceptName} title={concept.name}>
                    {editing ? (
                      <EditableField
                        value={concept.name}
                        onSave={(newName) => handleRename(concept.id, newName)}
                        inputStyle={{ fontSize: '32px', width: '100%', fontFamily: '"EB Garamond", Georgia, serif' }}
                        displayStyle={{ color: '#333' }}
                      />
                    ) : (
                      concept.name
                    )}
                  </h2>
                  {editing && altParentCount > 0 && (
                    <span style={styles.alsoAppears}>
                      Also appears under {altParentCount} other question{altParentCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {/* Phase 72b: hide the vote-only "N votes" count and the
                      Votes/Newest sort toggle in curated communities. */}
                  {votingAllowed && currentEdgeVoteCount !== null && (
                    <span style={styles.voteTotal}>
                      {currentEdgeVoteCount} {currentEdgeVoteCount === 1 ? 'vote' : 'votes'}
                    </span>
                  )}
                  {votingAllowed && (
                    <div style={{ ...styles.sortRow, marginLeft: 'auto', flexShrink: 0 }}>
                      {[
                        { value: 'saves', label: 'Votes' },
                        { value: 'new', label: 'Newest' },
                      ].map((opt, i) => (
                        <button
                          key={opt.value}
                          onClick={() => setSortMode(opt.value)}
                          style={{
                            ...styles.sortBtn,
                            ...(sortMode === opt.value ? styles.sortBtnActive : {}),
                            ...(i < 3 ? { borderRight: '1px solid #eee' } : {}),
                          }}
                        >{opt.label}</button>
                      ))}
                    </div>
                  )}
                  {hiddenCount > 0 && user && (
                    <button
                      onClick={() => setShowHiddenPanel(true)}
                      style={{ ...styles.hiddenBadge, ...(votingAllowed ? {} : { marginLeft: 'auto' }) }}
                      title={`${hiddenCount} hidden question${hiddenCount !== 1 ? 's' : ''} — click to review`}
                    >
                      {hiddenCount} hidden
                    </button>
                  )}
                </div>

                {currentEdgeDeleted ? (
                  <div style={styles.removedNotice}>This question has been removed.</div>
                ) : (
                <>

                {/* Phase 72f: the question's OWN answers/links under its title,
                    both modes. Curated → its answers (owners add/edit/remove in
                    edit mode); open → top link + expandable full list. */}
                {communityMode === 'curated' && currentEdgeId
                  && (editing || (currentAnswers && currentAnswers.length > 0)) && (
                  <div style={styles.ownPageSection}>
                    <CardAnswerSection
                      answers={currentAnswers || []}
                      edgeId={currentEdgeId}
                      canManage={isCommunityOwner}
                      editMode={editing}
                      isGuest={isGuest}
                      onRequestLogin={onRequestLogin}
                      onChanged={loadConcept}
                    />
                  </div>
                )}
                {openChildrenView && currentEdgeId && (
                  <div style={styles.ownPageSection}>
                    <CardLinksSection
                      mode="page"
                      edgeId={currentEdgeId}
                      conceptId={effectiveConceptId}
                      path={path}
                      isGuest={isGuest}
                      user={user}
                      onRequestLogin={onRequestLogin}
                      allowAddLink={!isGuest}
                      voteSets={voteSets}
                      onChanged={() => loadConcept({ silent: true })}
                      onOpenConceptTab={onOpenConceptTab}
                      pendingScrollLinkId={pendingScrollLinkId}
                      onPendingScrollLinkConsumed={onPendingScrollLinkConsumed}
                    />
                  </div>
                )}

                {bridges.length > 0 && (
                  <div style={styles.bridgeBar}>
                    <span style={styles.bridgeLabel}>Also asked in:</span>
                    {bridges.map((b) => (
                      <button
                        key={`${b.communityId}-${b.conceptId}`}
                        style={styles.bridgeChip}
                        onClick={() => handleBridgeClick(b)}
                        title={`View this question in ${b.communityName}`}
                      >
                        {b.communityName}
                      </button>
                    ))}
                  </div>
                )}

                {votingAllowed && (
                  <VoteSetBar
                    voteSets={voteSets}
                    activeSetIndices={activeSetIndices}
                    onSetClick={handleSetClick}
                    tieredView={tieredView}
                    onTieredToggle={handleTieredToggle}
                    userSetIndex={userSetIndex}
                  />
                )}

                {hasActiveFilters && (
                  <div style={styles.filterInfo}>
                    Showing {filteredCount} of {children.length} children matching selected patterns
                    {tieredView && effectiveIndices.length >= 2 && ' · tiered view'}
                  </div>
                )}

                {editing && showNewCard && (
                  <div style={styles.newCardWrap}>
                    <NewQuestionCard onCreate={handleCreateChildInline} onCancel={() => setShowNewCard(false)} placeholder="New child question…" />
                  </div>
                )}

                {children.length === 0 && !(editing && showNewCard) ? (
                  <div style={styles.emptyState}>
                    <p>{isGuest ? 'No child questions yet.' : (editing ? 'No child questions yet. Use the + button to add one.' : 'No child questions yet. Add one to get started!')}</p>
                  </div>
                ) : tieredSections ? (
                  tieredSections.map((section) => (
                    <ConceptGrid
                      key={`tier-${section.matchCount}`}
                      concepts={section.children}
                      onConceptClick={handleConceptClick}
                      onVote={(votingAllowed && !isGuest) ? handleVote : undefined}
                      onSwapClick={(votingAllowed && !isGuest) ? handleSwapClick : undefined}
                      onNestUnderSibling={(canCreate && communityMode !== 'curated') ? handleNestUnderSibling : undefined}
                      onFlag={(votingAllowed && !isGuest) ? handleFlag : undefined}
                      onUnflag={(votingAllowed && !isGuest) ? handleUnflag : undefined}
                      onNavigateNested={handleNavigateNested}
                      nestMode={nestMode}
                      selectedEdgeIds={selectedEdgeIds}
                      onToggleSelect={toggleNestSelect}
                      showVotes={votingAllowed}
                      path={path}
                      edgeToSets={votingAllowed ? edgeToSets : {}}
                      tierLabel={section.label}
                      showAnswers={communityMode === 'curated'}
                      canManageAnswers={isCommunityOwner}
                      onAnswersChanged={loadConcept}
                      showLinks={communityMode !== 'curated'}
                      canAddLink={!isGuest}
                      voteSets={votingAllowed ? voteSets : []}
                      onLinksChanged={() => loadConcept({ silent: true })}
                      onOpenConceptTab={onOpenConceptTab}
                      isGuest={isGuest}
                      onRequestLogin={onRequestLogin}
                      showFeedback={communityMode === 'curated'}
                      currentUserId={user?.id || null}
                      onFeedbackChanged={refreshFeedbackCounts}
                      autoOpenFeedbackEdgeId={autoOpenCardEdgeId}
                      onFeedbackAutoOpened={onPendingFeedbackConsumed}
                    />
                  ))
                ) : (
                  <ConceptGrid
                    concepts={displayChildren}
                    onConceptClick={handleConceptClick}
                    onVote={(votingAllowed && !isGuest) ? handleVote : undefined}
                    onSwapClick={(votingAllowed && !isGuest) ? handleSwapClick : undefined}
                    onNestUnderSibling={(canCreate && !editing && communityMode !== 'curated') ? handleNestUnderSibling : undefined}
                    onFlag={(votingAllowed && !isGuest) ? handleFlag : undefined}
                    onUnflag={(votingAllowed && !isGuest) ? handleUnflag : undefined}
                    onNavigateNested={handleNavigateNested}
                    nestMode={nestMode}
                    restructureMode={editing}
                    onUngroup={editing ? handleUngroup : undefined}
                    selectedEdgeIds={editing ? restructureSel : selectedEdgeIds}
                    onToggleSelect={editing ? toggleRestructureSelect : toggleNestSelect}
                    showVotes={votingAllowed}
                    path={path}
                    edgeToSets={votingAllowed ? edgeToSets : {}}
                    showAnswers={communityMode === 'curated'}
                    canManageAnswers={isCommunityOwner}
                    onAnswersChanged={loadConcept}
                    showLinks={communityMode !== 'curated'}
                    canAddLink={!isGuest}
                    voteSets={votingAllowed ? voteSets : []}
                    onLinksChanged={() => loadConcept({ silent: true })}
                    onOpenConceptTab={onOpenConceptTab}
                    isGuest={isGuest}
                    onRequestLogin={onRequestLogin}
                    editMode={editing}
                    onRename={editing ? handleRename : undefined}
                    onDeleteEdge={editing ? handleDeleteEdge : undefined}
                    showFeedback={communityMode === 'curated'}
                    currentUserId={user?.id || null}
                    onFeedbackChanged={refreshFeedbackCounts}
                    autoOpenFeedbackEdgeId={autoOpenCardEdgeId}
                    onFeedbackAutoOpened={onPendingFeedbackConsumed}
                  />
                )}
                </>
                )}
              </>
            ) : (
              <TunnelView
                conceptId={effectiveConceptId}
                edgeId={parentEdgeId}
                path={effectivePath}
                isGuest={isGuest}
                onNavigate={handleTunnelNavigate}
                onOpenNewTab={handleOpenNewTab}
                pendingScrollTunnelLinkId={pendingScrollTunnelLinkId}
                onPendingScrollTunnelLinkConsumed={onPendingScrollTunnelLinkConsumed}
              />
            )}
        </div>
      </main>

      <SearchField
        parentId={effectiveConceptId}
        path={searchPath}
        viewMode={effectiveViewMode}
        onConceptAdded={handleConceptAdded}
        graphTabId={graphTabId}
        onNavigate={onNavigate}
        isGuest={isGuest}
        canCreate={canCreate && !currentEdgeDeleted}
        communityId={concept?.community_id}
        curated={communityMode === 'curated'}
      />

      {/* Phase 72c-1: edit-mode add-child button (curated owners, children view) */}
      {editing && !showNewCard && !nestMode && !currentEdgeDeleted && (
        <button
          style={styles.addFab}
          onClick={() => setShowNewCard(true)}
          title="Add a child question"
        >+</button>
      )}

      {/* Phase 72e-2: page-level branch suggestions (curated, children view) */}
      {communityMode === 'curated' && effectiveViewMode === 'children' && parentEdgeId && !currentEdgeDeleted && (
        <PageFeedbackLauncher
          communityId={concept?.community_id}
          parentEdgeId={parentEdgeId}
          questionText={concept?.name}
          isOwner={isCommunityOwner}
          isGuest={isGuest}
          onRequestLogin={onRequestLogin}
          onChanged={refreshFeedbackCounts}
          autoOpen={autoOpenPagePanel}
          onAutoOpenConsumed={onPendingFeedbackConsumed}
        />
      )}

      {showAddModal && (
        <AddConceptModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddConcept}
          title={`Add Child to "${concept.name}"`}
        />
      )}

      {swapModalEdge && (
        <SwapModal
          edgeId={swapModalEdge.edgeId}
          conceptName={swapModalEdge.conceptName}
          onClose={handleSwapModalClose}
          onSwapVoteChanged={handleSwapVoteChanged}
        />
      )}

      {/* Phase 16c: Hidden Concepts Panel */}
      {showHiddenPanel && (
        <HiddenConceptsView
          parentId={effectiveConceptId}
          path={effectivePath}
          onClose={() => { setShowHiddenPanel(false); loadHiddenCount(); loadConcept(); }}
        />
      )}

      {/* Nest-under-sibling action bar */}
      {nestMode && (() => {
        const eligibleTargets = children.filter((c) => !selectedEdgeIds.has(c.edge_id));
        const targetConcept = children.find((c) => c.edge_id === nestTargetEdgeId);
        return (
          <div style={styles.nestBar}>
            <span style={styles.nestBarText}>
              {selectedEdgeIds.size} question{selectedEdgeIds.size === 1 ? '' : 's'} selected to nest
            </span>
            <div style={{ position: 'relative' }}>
              <button
                style={styles.nestBarPickerButton}
                onClick={() => setNestPickerOpen((o) => !o)}
                disabled={eligibleTargets.length === 0}
                title="Choose the sibling question to nest the selected questions under"
              >
                {targetConcept ? `Under: ${targetConcept.name}` : 'Question to nest under'} {'▾'}
              </button>
              {nestPickerOpen && (
                <div style={styles.nestPickerDropdown}>
                  {eligibleTargets.length === 0 ? (
                    <div style={styles.nestPickerEmpty}>No eligible questions</div>
                  ) : eligibleTargets.map((c) => (
                    <div
                      key={c.edge_id}
                      style={styles.nestPickerItem}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0ece4')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      onClick={() => { setNestTargetEdgeId(c.edge_id); setNestPickerOpen(false); }}
                    >
                      {c.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              style={{
                ...styles.nestBarConfirm,
                ...((selectedEdgeIds.size === 0 || !nestTargetEdgeId || nestSubmitting) ? styles.nestBarDisabled : {}),
              }}
              onClick={confirmNest}
              disabled={selectedEdgeIds.size === 0 || !nestTargetEdgeId || nestSubmitting}
            >
              {nestSubmitting ? 'Nesting…' : 'Confirm'}
            </button>
            <button style={styles.nestBarCancel} onClick={cancelNest} disabled={nestSubmitting}>
              Cancel
            </button>
            {nestFeedback && <span style={styles.nestBarFeedback}>{nestFeedback}</span>}
          </div>
        );
      })()}

      {!nestMode && nestFeedback && (
        <div style={styles.nestToast}>{nestFeedback}</div>
      )}

      {/* Phase 73: curated restructure action bar (group / move into / ungroup). */}
      {editing && !currentEdgeDeleted && (restructureSel.size > 0 || ungroupConcept) && (
        <RestructureBar
          selectedEdgeIds={restructureSel}
          siblings={children}
          ungroupConcept={ungroupConcept}
          onClearSelection={clearRestructureSelection}
          onCloseUngroup={() => setUngroupConcept(null)}
          onDone={handleRestructureDone}
        />
      )}

    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#f5f5f5',
  },
  headerBar: {
    backgroundColor: 'white',
    borderBottom: '1px solid #ddd',
    padding: '12px 20px',
  },
  headerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px 20px',
  },
  breadcrumbWithBack: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  },
  buttonSection: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  editToggle: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
  },
  editToggleActive: {
    padding: '8px 16px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
  },
  alsoAppears: {
    fontSize: '13px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  newCardWrap: {
    maxWidth: '420px',
  },
  addFab: {
    position: 'fixed',
    bottom: '96px',
    right: '28px',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: '1px solid #333',
    backgroundColor: '#faf9f6',
    color: '#333',
    fontSize: '26px',
    lineHeight: '1',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    zIndex: 1001,
  },
  shareButtonWrapper: {
    position: 'relative',
  },
  shareButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  annotateButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  comboPickerDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    minWidth: '220px',
    maxWidth: '320px',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    zIndex: 100,
    overflow: 'hidden',
  },
  comboPickerItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid #f0f0f0',
    backgroundColor: 'white',
    transition: 'background-color 0.1s',
  },
  comboPickerName: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '500',
  },
  comboPickerMeta: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    whiteSpace: 'nowrap',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    // Bottom padding clears the fixed Add/Search bar (≈54px tall, 30px above the
    // viewport bottom) so it never overlaps the last card / add-answer form.
    padding: '40px 20px 120px',
  },
  // Phase 46: flex-wrap so sort toggles reflow below the concept name at narrow widths
  // instead of compressing the name into an unreadable sliver.
  conceptHeader: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '8px 12px',
    marginBottom: '20px',
  },
  // Phase 72f: the question's own answers/links block under its title.
  ownPageSection: {
    backgroundColor: 'white',
    border: '1px solid #e8e4dc',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '20px',
  },
  bridgeBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  bridgeLabel: {
    fontSize: '13px',
    color: '#888',
  },
  bridgeChip: {
    padding: '3px 10px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#faf9f6',
    border: '1px solid #cfc9bd',
    borderRadius: '12px',
    cursor: 'pointer',
    color: '#333',
  },
  conceptName: {
    fontSize: '32px',
    margin: 0,
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    minWidth: 0,
    flex: 1,
  },
  attributeTagHeader: {
    color: '#888',
    fontWeight: '400',
    fontSize: '24px',
  },
  graphAttributeBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f0ede8',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#555',
    marginLeft: '8px',
    verticalAlign: 'middle',
    flexShrink: 0,
  },
  voteTotal: {
    fontSize: '16px',
    color: '#888',
  },
  sortRow: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  sortBtn: {
    padding: '3px 10px',
    border: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  sortBtnActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  hiddenBadge: {
    padding: '4px 10px',
    fontSize: '12px',
    backgroundColor: '#f5f0ea',
    color: '#555',
    border: '1px solid #d4d0c8',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    marginLeft: '8px',
  },
  filterInfo: {
    fontSize: '13px',
    color: '#888',
    fontStyle: 'normal',
    marginBottom: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#666',
  },
  error: {
    padding: '15px',
    backgroundColor: '#fee',
    color: '#c33',
    borderRadius: '4px',
    margin: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
  removedNotice: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '18px',
  },
  nestBar: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90vw',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    padding: '12px 18px',
    zIndex: 10002,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarText: {
    fontSize: '15px',
    color: '#333',
  },
  nestBarPickerButton: {
    padding: '8px 14px',
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    maxWidth: '320px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nestPickerDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '6px',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    minWidth: '240px',
    maxWidth: '360px',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 10003,
    fontSize: '14px',
  },
  nestPickerItem: {
    padding: '8px 14px',
    cursor: 'pointer',
    color: '#333',
  },
  nestPickerEmpty: {
    padding: '8px 14px',
    color: '#888',
  },
  nestBarConfirm: {
    padding: '8px 18px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarDisabled: {
    opacity: 0.45,
    cursor: 'default',
  },
  nestBarCancel: {
    padding: '8px 14px',
    backgroundColor: 'white',
    color: '#555',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarFeedback: {
    fontSize: '14px',
    color: '#c33',
    width: '100%',
    textAlign: 'center',
  },
  nestToast: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    padding: '12px 18px',
    zIndex: 10002,
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
  },
};

export default Concept;
