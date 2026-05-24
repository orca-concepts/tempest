import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { votesAPI, combosAPI, tunnelsAPI } from '../services/api';
import { arrayMove } from '@dnd-kit/sortable';
import Root from '../pages/Root';
import Concept from '../pages/Concept';
import VotesOverlay from '../components/VotesOverlay';
import LoginModal from '../components/LoginModal';
import DeleteAccountFlow from '../components/DeleteAccountFlow';
import SidebarDndContext, { SortableItem, SortableGroupWrapper, GroupMemberContext } from '../components/SidebarDndContext';
import InfoPage from '../components/InfoPage';
import ComboListView from '../components/ComboListView';
import ComboTabContent from '../components/ComboTabContent';
import LegalPage from '../components/LegalPage';
import TermsPage from '../components/TermsPage';
import PrivacyPage from '../components/PrivacyPage';
import CopyrightPolicyPage from '../components/CopyrightPolicyPage';
import AdminLegalRemovalsPanel from '../components/AdminLegalRemovalsPanel';
import TheStormPage from '../components/TheStormPage';
import CopyrightPage from '../components/CopyrightPage';
import InfringementNoticePage from '../components/InfringementNoticePage';
import CounterNoticePage from '../components/CounterNoticePage';
import OutreachLanding from '../components/OutreachLanding';

const isOutreachMode = import.meta.env.VITE_OUTREACH_MODE === 'true';

const AppShell = () => {
  const { logout, logoutEverywhere, user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Phase 30g: Info page detection and header nav
  const INFO_SLUGS = ['using-orca', 'the-storm'];
  const LEGAL_SLUGS = ['legal', 'terms', 'privacy', 'copyright', 'copyright-policy', 'report-infringement', 'counter-notice', 'admin/legal'];
  const infoSlug = INFO_SLUGS.find(s => location.pathname === `/${s}`);
  const isLegalPage = LEGAL_SLUGS.some(s => location.pathname === `/${s}`);

  // Graph tabs (new Phase 5c — persistent navigation panes)
  const [graphTabs, setGraphTabs] = useState([]);

  // Tab groups (Phase 5d)
  const [tabGroups, setTabGroups] = useState([]);

  // Sidebar Items (Phase 19b — unified ordered list)
  const [sidebarItems, setSidebarItems] = useState([]);

  // DnD state (Phase 19c)
  const [activeDragId, setActiveDragId] = useState(null); // sidebar_item.id being dragged
  const [overGroupItemId, setOverGroupItemId] = useState(null); // sidebar_item.id of group being hovered

  // Phase 28f: Login modal state
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalTab, setLoginModalTab] = useState('login');
  const [loginModalNotice, setLoginModalNotice] = useState('');
  const [pendingOrcidData, setPendingOrcidData] = useState(null);

  // Phase 35d: Account dropdown menu and delete flow
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const accountMenuRef = useRef(null);

  const handleRequestLogin = useCallback(() => {
    setLoginModalTab('login');
    setLoginModalNotice('');
    setShowLoginModal(true);
  }, []);

  // Phase 61c: Detect ORCID registration callback and open signup step 2
  useEffect(() => {
    if (location.state?.openSignupStep2) {
      try {
        const stored = sessionStorage.getItem('orca_pending_orcid_registration');
        if (stored) {
          const data = JSON.parse(stored);
          setPendingOrcidData(data);
          setLoginModalTab('signup');
          setLoginModalNotice('');
          setShowLoginModal(true);
        }
      } catch {}
      // Clear the navigation state so refresh doesn't re-trigger
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Active tab: { type: 'corpus', id: N } or { type: 'graph', id: N }
  const [activeTab, setActiveTab] = useState(null);

  // Group renaming state
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [groupRenameValue, setGroupRenameValue] = useState('');
  const groupRenameInputRef = useRef(null);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, tabType, tabId } or { x, y, groupId }

  // Loading
  const [loading, setLoading] = useState(true);

  // Phase 59b: Unified Votes overlay
  const [votesOpen, setVotesOpen] = useState(false);

  // Phase 39b: Combo browse overlay state
  const [comboView, setComboView] = useState(null); // null | { view: 'list' }
  const [guestComboId, setGuestComboId] = useState(null); // deep-linked combo for guests

  // Phase 39b: Combo subscriptions (persistent combo tabs)
  const [comboSubscriptions, setComboSubscriptions] = useState([]);

  // Phase 39d: User's owned combos (for "Add to Combo" button in Concept)
  const [ownedCombos, setOwnedCombos] = useState([]);

  // Phase 39e: Refresh key to signal ComboTabContent to reload after edge added from graph
  const [comboRefreshKey, setComboRefreshKey] = useState(0);

  // Phase 58d: Pending scroll-to-link after cross-concept navigation
  const [pendingScrollLinkId, setPendingScrollLinkId] = useState(null);

  // Phase 65a: Pending scroll-to-tunnel-link
  const [pendingScrollTunnelLinkId, setPendingScrollTunnelLinkId] = useState(null);

  // Phase 65a: Toast for unavailable link/tunnel share URLs
  const [unavailableLinkToast, setUnavailableLinkToast] = useState(false);
  useEffect(() => {
    if (!unavailableLinkToast) return;
    const timer = setTimeout(() => setUnavailableLinkToast(false), 4000);
    return () => clearTimeout(timer);
  }, [unavailableLinkToast]);

  // Phase 12b: Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Guest tab ID counter (ephemeral, local-only tabs for non-logged-in users)
  const guestTabCounter = useRef(1);

  // Phase 30c: Browser history integration for graph tab navigation
  const popstateInProgressRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const graphTabsRef = useRef(graphTabs);
  useEffect(() => { graphTabsRef.current = graphTabs; }, [graphTabs]);

  // Load all tabs + groups on mount (skip for guests)
  useEffect(() => {
    document.title = 'orca';
    if (isGuest) {
      // Guest mode: create one ephemeral local-only graph tab
      const guestTab = {
        id: 'guest-1',
        tab_type: 'root',
        concept_id: null,
        path: [],
        view_mode: 'children',
        label: 'Root',
        group_id: null,
      };
      setGraphTabs([guestTab]);
      setActiveTab({ type: 'graph', id: 'guest-1' });
      setLoading(false);
    } else {
      loadAllTabs();
    }
  }, [isGuest]);

  // Deep link: /concept/:id and /superconcept/:id
  useEffect(() => {
    if (loading || authLoading) return;

    // /concept/:id?path=1,2,3
    const conceptMatch = location.pathname.match(/^\/concept\/(\d+)$/);
    if (conceptMatch) {
      const conceptId = parseInt(conceptMatch[1]);
      const params = new URLSearchParams(location.search);
      const pathStr = params.get('path');
      const path = pathStr ? pathStr.split(',').map(Number).filter(Boolean) : [];
      handleOpenConceptTab(conceptId, path);
      navigate('/', { replace: true });
      return;
    }

    // /superconcept/:id
    const comboMatch = location.pathname.match(/^\/superconcept\/(\d+)$/);
    if (comboMatch) {
      const comboId = parseInt(comboMatch[1]);
      if (isGuest) {
        setGuestComboId(comboId);
      } else {
        handleSubscribeToCombo(comboId, '');
      }
      navigate('/', { replace: true });
      return;
    }

    // Phase 65a: /link/:id — resolve to concept page with fragment
    const linkMatch = location.pathname.match(/^\/link\/(\d+)$/);
    if (linkMatch) {
      const linkId = parseInt(linkMatch[1], 10);
      votesAPI.getWebLinkLocation(linkId)
        .then(({ data }) => {
          setPendingScrollLinkId(linkId);
          handleOpenConceptTab(data.conceptId, data.parentPath);
          navigate('/', { replace: true });
        })
        .catch(() => {
          setUnavailableLinkToast(true);
          navigate('/', { replace: true });
        });
      return;
    }

    // Phase 65a: /tunnel/:id — resolve to concept page with tunnel view
    const tunnelMatch = location.pathname.match(/^\/tunnel\/(\d+)$/);
    if (tunnelMatch) {
      const tunnelLinkId = parseInt(tunnelMatch[1], 10);
      tunnelsAPI.getTunnelLocation(tunnelLinkId)
        .then(({ data }) => {
          setPendingScrollTunnelLinkId(tunnelLinkId);
          handleOpenConceptTab(data.conceptId, data.parentPath);
          navigate('/', { replace: true });
        })
        .catch(() => {
          setUnavailableLinkToast(true);
          navigate('/', { replace: true });
        });
      return;
    }
  }, [loading, authLoading, location.pathname]);

  // Phase 30c: Build URL for graph tab history entries
  const buildGraphTabUrl = (tabId, tabType, conceptId, path, viewMode) => {
    const params = new URLSearchParams();
    params.set('gtab', String(tabId));
    if (tabType === 'concept' && conceptId) {
      params.set('c', String(conceptId));
      if (path && path.length > 0) {
        params.set('p', path.join(','));
      }
      if (viewMode === 'flip') {
        params.set('v', 'flip');
      }
    }
    return '?' + params.toString();
  };

  // Phase 30c: Popstate listener for browser back/forward within graph tabs
  useEffect(() => {
    const handlePopstate = (event) => {
      const state = event.state;
      if (!state || !state.orcaNav) return;

      popstateInProgressRef.current = true;

      // Switch to the correct tab if needed
      const cur = activeTabRef.current;
      if (!cur || cur.type !== 'graph' || cur.id !== state.tabId) {
        setActiveTab({ type: 'graph', id: state.tabId });
      }

      // Update the graph tab's state
      const updates = {
        tab_type: state.tabType,
        concept_id: state.conceptId,
        path: state.path || [],
        view_mode: state.viewMode || 'children',
      };
      setGraphTabs(prev => prev.map(t =>
        t.id === state.tabId ? { ...t, ...updates } : t
      ));

      // Persist to DB (non-blocking)
      if (!isGuest) {
        votesAPI.updateGraphTab(state.tabId, {
          tabType: state.tabType,
          conceptId: state.conceptId,
          path: state.path || [],
          viewMode: state.viewMode || 'children',
        }).catch(err => console.error('Failed to persist popstate nav:', err));
      }

      document.title = 'orca';
      popstateInProgressRef.current = false;
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [isGuest]);

  // Phase 30c: Seed initial history entry once tabs are loaded
  useEffect(() => {
    if (loading || !activeTab || activeTab.type !== 'graph') return;
    // Only seed if history state is not already ours (first load)
    if (window.history.state && window.history.state.orcaNav) return;
    const tab = graphTabs.find(t => t.id === activeTab.id);
    if (!tab) return;
    const state = {
      orcaNav: true,
      tabId: tab.id,
      tabType: tab.tab_type,
      conceptId: tab.concept_id,
      path: tab.path || [],
      viewMode: tab.view_mode || 'children',
    };
    const url = buildGraphTabUrl(tab.id, tab.tab_type, tab.concept_id, tab.path, tab.view_mode);
    window.history.replaceState(state, '', url);
  }, [loading, activeTab, graphTabs]);

  useEffect(() => {
    if (renamingGroupId && groupRenameInputRef.current) {
      groupRenameInputRef.current.focus();
      groupRenameInputRef.current.select();
    }
  }, [renamingGroupId]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.document.addEventListener('click', handleClick);
      return () => window.document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // Close account menu on click outside
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClick = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setShowAccountMenu(false);
      }
    };
    window.document.addEventListener('mousedown', handleClick);
    return () => window.document.removeEventListener('mousedown', handleClick);
  }, [showAccountMenu]);

  const loadAllTabs = async () => {
    try {
      setLoading(true);
      const [graphRes, groupsRes, sidebarRes, comboSubsRes, myCombosRes] = await Promise.all([
        votesAPI.getGraphTabs().catch(() => ({ data: { graphTabs: [] } })),
        votesAPI.getTabGroups().catch(() => ({ data: { tabGroups: [] } })),
        votesAPI.getSidebarItems().catch(err => {
          console.warn('getSidebarItems failed, sidebar order will be default:', err);
          return { data: { items: [] } };
        }),
        combosAPI.getSubscriptions().catch(() => ({ data: { subscriptions: [] } })),
        combosAPI.getMyCombos().catch(() => ({ data: { combos: [] } })),
      ]);
      const loadedGraph = graphRes.data.graphTabs;
      const loadedGroups = groupsRes.data.tabGroups;
      const loadedComboSubs = (comboSubsRes.data.subscriptions || []).map(sub => ({
        id: sub.id, // combo ID
        combo_id: sub.id,
        name: sub.name,
        subscriber_count: sub.subscriber_count,
        group_id: sub.group_id || null,
      }));
      setGraphTabs(loadedGraph);
      setTabGroups(loadedGroups);
      setComboSubscriptions(loadedComboSubs);
      setOwnedCombos(myCombosRes.data.combos || []);
      setSidebarItems(sidebarRes.data.items || []);

      // Set active tab: prefer first graph tab, then first corpus tab
      if (loadedGraph.length > 0) {
        setActiveTab({ type: 'graph', id: loadedGraph[0].id });
      } else {
        // No tabs at all — will auto-create a default graph tab
        createDefaultGraphTab();
      }
    } catch (err) {
      console.error('Failed to load tabs:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshSidebarItems = async () => {
    try {
      const res = await votesAPI.getSidebarItems();
      setSidebarItems(res.data.items || []);
    } catch (err) {
      // non-critical
    }
  };

  // ─── Sidebar DnD Handlers (Phase 19c) ──────────────────

  const handleDragStart = ({ active }) => {
    setActiveDragId(active.id);
  };

  const handleDragOver = ({ active, over }) => {
    if (!over) { setOverGroupItemId(null); return; }
    const activeItem = sidebarItems.find(i => i.id === active.id);
    const overItem = sidebarItems.find(i => i.id === over.id);
    // Highlight a group when dragging a graph_tab or combo over it
    if ((activeItem?.item_type === 'graph_tab' || activeItem?.item_type === 'combo') && overItem?.item_type === 'group') {
      setOverGroupItemId(over.id);
    } else {
      setOverGroupItemId(null);
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveDragId(null);
    setOverGroupItemId(null);
    if (!over || active.id === over.id) return;

    const activeItem = sidebarItems.find(i => i.id === active.id);
    const overItem = sidebarItems.find(i => i.id === over.id);
    if (!activeItem || !overItem) return;

    const activeGraphTab = activeItem.item_type === 'graph_tab'
      ? graphTabs.find(t => t.id === activeItem.item_id) : null;
    const activeComboTab = activeItem.item_type === 'combo'
      ? comboSubscriptions.find(c => c.id === activeItem.item_id) : null;
    const activeIsGrouped = !!(activeGraphTab?.group_id || activeComboTab?.group_id);
    const activeDragType = activeItem.item_type === 'graph_tab' ? 'graph'
      : activeItem.item_type === 'combo' ? 'combo' : null;

    // Case 1: Drop a graph_tab or combo onto a group → move to that group
    if ((activeItem.item_type === 'graph_tab' || activeItem.item_type === 'combo') && overItem.item_type === 'group') {
      const tabId = activeItem.item_id;
      const newGroupId = overItem.item_id;
      const oldGroupId = (activeGraphTab || activeComboTab)?.group_id || null;
      if (oldGroupId === newGroupId) return;
      if (activeDragType === 'graph') {
        setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: newGroupId } : t));
      } else {
        setComboSubscriptions(prev => prev.map(c => c.id === tabId ? { ...c, group_id: newGroupId } : c));
      }
      try {
        if (oldGroupId) await votesAPI.removeTabFromGroup(activeDragType, tabId);
        await votesAPI.addTabToGroup(activeDragType, tabId, newGroupId);
        await refreshSidebarItems();
      } catch (err) {
        if (activeDragType === 'graph') {
          setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: oldGroupId } : t));
        } else {
          setComboSubscriptions(prev => prev.map(c => c.id === tabId ? { ...c, group_id: oldGroupId } : c));
        }
        console.error('Failed to move tab into group:', err);
      }
      return;
    }

    // Case 2: Grouped tab dropped on a non-group top-level item → pull out of group
    if (activeIsGrouped && overItem.item_type !== 'group') {
      const tabId = activeItem.item_id;
      const oldGroupId = (activeGraphTab || activeComboTab)?.group_id;
      if (activeDragType === 'graph') {
        setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: null } : t));
      } else if (activeDragType === 'combo') {
        setComboSubscriptions(prev => prev.map(c => c.id === tabId ? { ...c, group_id: null } : c));
      }
      try {
        await votesAPI.removeTabFromGroup(activeDragType, tabId);
        await refreshSidebarItems();
      } catch (err) {
        if (activeDragType === 'graph') {
          setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: oldGroupId } : t));
        } else if (activeDragType === 'combo') {
          setComboSubscriptions(prev => prev.map(c => c.id === tabId ? { ...c, group_id: oldGroupId } : c));
        }
        console.error('Failed to pull tab out of group:', err);
      }
      return;
    }

    // Case 3: Reorder top-level items
    const topLevelItems = sidebarItems.filter(item => {
      if (item.item_type === 'graph_tab') {
        return !graphTabs.find(t => t.id === item.item_id)?.group_id;
      }
      if (item.item_type === 'combo') {
        return !comboSubscriptions.find(c => c.id === item.item_id)?.group_id;
      }
      return true;
    });
    const oldIndex = topLevelItems.findIndex(i => i.id === active.id);
    const newIndex = topLevelItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reorderedTop = arrayMove(topLevelItems, oldIndex, newIndex)
      .map((item, i) => ({ ...item, display_order: (i + 1) * 10 }));

    // Optimistic update
    setSidebarItems(prev => {
      const grouped = prev.filter(item =>
        (item.item_type === 'graph_tab' && !!graphTabs.find(t => t.id === item.item_id)?.group_id) ||
        (item.item_type === 'combo' && !!comboSubscriptions.find(c => c.id === item.item_id)?.group_id)
      );
      return [...reorderedTop, ...grouped];
    });

    try {
      await votesAPI.reorderSidebarItems(
        reorderedTop.map(item => ({ id: item.id, display_order: item.display_order }))
      );
    } catch (err) {
      await refreshSidebarItems();
      console.error('Failed to reorder sidebar items:', err);
    }
  };

  // ─── Graph Tab Actions ───────────────────────────────────

  const handleCreateGraphTab = async () => {
    if (isGuest) {
      // Guest mode: ephemeral local-only tab
      guestTabCounter.current += 1;
      const newTab = {
        id: `guest-${guestTabCounter.current}`,
        tab_type: 'root',
        concept_id: null,
        path: [],
        view_mode: 'children',
        label: 'Root',
        group_id: null,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }
    try {
      const res = await votesAPI.createGraphTab('root', null, [], 'children', 'Root');
      const newTab = res.data.graphTab;
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to create graph tab:', err);
    }
  };

  const handleCloseGraphTab = async (tabId) => {
    if (isGuest) {
      // Guest mode: just remove from local state
      setGraphTabs(prev => {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const remaining = prev.filter(t => t.id !== tabId);
        if (activeTab?.type === 'graph' && activeTab?.id === tabId) {
          if (remaining.length > 0) {
            const nextIndex = Math.min(closedIndex, remaining.length - 1);
            setActiveTab({ type: 'graph', id: remaining[nextIndex].id });
          } else {
            // Create a new ephemeral tab
            guestTabCounter.current += 1;
            const newTab = {
              id: `guest-${guestTabCounter.current}`,
              tab_type: 'root', concept_id: null, path: [],
              view_mode: 'children', label: 'Root', group_id: null,
            };
            setActiveTab({ type: 'graph', id: newTab.id });
            return [newTab];
          }
        }
        return remaining;
      });
      return;
    }
    try {
      await votesAPI.closeGraphTab(tabId);
      setGraphTabs(prev => {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const remaining = prev.filter(t => t.id !== tabId);

        // If we closed the active tab, switch to the adjacent tab (Chrome-style)
        if (activeTab?.type === 'graph' && activeTab?.id === tabId) {
          if (remaining.length > 0) {
            const nextIndex = Math.min(closedIndex, remaining.length - 1);
            setActiveTab({ type: 'graph', id: remaining[nextIndex].id });
          } else {
            createDefaultGraphTab();
          }
        }
        return remaining;
      });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to close graph tab:', err);
    }
  };

  const createDefaultGraphTab = async () => {
    try {
      const res = await votesAPI.createGraphTab('root', null, [], 'children', 'Root');
      const newTab = res.data.graphTab;
      setGraphTabs([newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to auto-create graph tab:', err);
    }
  };

  const handleDuplicateGraphTab = async (tabId) => {
    const tab = graphTabs.find(t => t.id === tabId);
    if (!tab) return;
    if (isGuest) {
      guestTabCounter.current += 1;
      const newTab = {
        ...tab,
        id: `guest-${guestTabCounter.current}`,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }
    try {
      const res = await votesAPI.createGraphTab(
        tab.tab_type, tab.concept_id, tab.path, tab.view_mode, tab.label
      );
      const newTab = res.data.graphTab;
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to duplicate graph tab:', err);
    }
  };

  const handleGraphTabNavigate = useCallback(async (tabId, updates) => {
    const normalized = {};
    if (updates.tabType !== undefined)   normalized.tab_type   = updates.tabType;
    if (updates.conceptId !== undefined) normalized.concept_id = updates.conceptId;
    if (updates.path !== undefined)      normalized.path       = updates.path;
    if (updates.viewMode !== undefined)  normalized.view_mode  = updates.viewMode;
    if (updates.label !== undefined)     normalized.label      = updates.label;

    // Phase 30c: Determine if this is a navigation change (not just a label update)
    const isNavChange = updates.conceptId !== undefined || updates.path !== undefined ||
                        updates.viewMode !== undefined || updates.tabType !== undefined;

    setGraphTabs(prev => {
      const updated = prev.map(t =>
        t.id === tabId ? { ...t, ...normalized } : t
      );

      // Phase 30c: Push browser history for navigation changes (not label-only, not popstate)
      if (isNavChange && !popstateInProgressRef.current) {
        const tab = updated.find(t => t.id === tabId);
        if (tab) {
          const state = {
            orcaNav: true,
            tabId: tab.id,
            tabType: tab.tab_type,
            conceptId: tab.concept_id,
            path: tab.path || [],
            viewMode: tab.view_mode || 'children',
          };
          const url = buildGraphTabUrl(tab.id, tab.tab_type, tab.concept_id, tab.path, tab.view_mode);
          window.history.pushState(state, '', url);
          document.title = 'orca';
        }
      }

      return updated;
    });

    // Guest mode: no DB persistence
    if (isGuest) return;

    try {
      await votesAPI.updateGraphTab(tabId, updates);
    } catch (err) {
      console.error('Failed to update graph tab:', err);
    }
  }, [isGuest]);

  const handleOpenConceptTab = useCallback(async (conceptId, path, conceptName, attributeName, sourceCorpusTabId, viewMode, scrollToLinkId) => {
    const label = conceptName || 'Concept';
    const tabType = conceptId ? 'concept' : 'root';
    const effectiveViewMode = viewMode || 'children';

    // Set pending scroll if a target link was specified (cross-concept instance navigation)
    if (scrollToLinkId) setPendingScrollLinkId(scrollToLinkId);

    // Check if a graph tab for this concept already exists — reuse it instead of creating a duplicate.
    // Uses graphTabsRef to read fresh state (avoids stale closure in useCallback).
    const currentTabs = graphTabsRef.current;
    const existingTab = conceptId
      ? currentTabs.find(t => t.concept_id === conceptId || t.concept_id === Number(conceptId))
      : null;
    if (existingTab) {
      // Navigate the existing tab to the requested path/viewMode
      const updates = { path: path || [], viewMode: effectiveViewMode };
      setGraphTabs(prev => prev.map(t =>
        t.id === existingTab.id ? { ...t, path: updates.path, view_mode: updates.viewMode, label } : t
      ));
      setActiveTab({ type: 'graph', id: existingTab.id });
      if (!isGuest) {
        votesAPI.updateGraphTab(existingTab.id, { path: updates.path, viewMode: updates.viewMode, label }).catch(() => {});
      }
      return;
    }

    if (isGuest) {
      guestTabCounter.current += 1;
      const newTab = {
        id: `guest-${guestTabCounter.current}`,
        tab_type: tabType,
        concept_id: conceptId,
        path: path,
        view_mode: effectiveViewMode,
        label,
        group_id: null,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }

    try {
      const res = await votesAPI.createGraphTab(tabType, conceptId, path, effectiveViewMode, label);
      const newTab = res.data.graphTab;

      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to open concept tab:', err);
    }
  }, [isGuest, tabGroups]);

  // ─── Combo Subscribe/Unsubscribe (Phase 39b) ──────────────

  const reloadComboSubscriptions = useCallback(async () => {
    try {
      const [subsRes, myCombosRes] = await Promise.all([
        combosAPI.getSubscriptions().catch(() => ({ data: { subscriptions: [] } })),
        combosAPI.getMyCombos().catch(() => ({ data: { combos: [] } })),
      ]);
      setComboSubscriptions((subsRes.data.subscriptions || []).map(sub => ({
        id: sub.id,
        combo_id: sub.id,
        name: sub.name,
        subscriber_count: sub.subscriber_count,
        group_id: sub.group_id || null,
      })));
      setOwnedCombos(myCombosRes.data.combos || []);
      await refreshSidebarItems();
    } catch (err) {
      // non-critical
    }
  }, []);

  const handleSubscribeToCombo = useCallback(async (comboId, comboName) => {
    if (isGuest) {
      handleRequestLogin();
      return;
    }
    try {
      await combosAPI.subscribe(comboId);
      const newSub = { id: comboId, combo_id: comboId, name: comboName, subscriber_count: 0 };
      setComboSubscriptions(prev => [...prev, newSub]);
      setActiveTab({ type: 'combo', id: comboId });
      setComboView(null);
     
      setSavedPageOpen(false);
     
     
      await refreshSidebarItems();
    } catch (err) {
      if (err.response?.status === 409) {
        // Already subscribed — just switch to the tab
        setActiveTab({ type: 'combo', id: comboId });
        setComboView(null);
       
        setSavedPageOpen(false);
       
       
      } else if (err.response?.status === 401) {
        handleRequestLogin();
      } else {
        alert(err.response?.data?.error || 'Failed to subscribe');
      }
    }
  }, [isGuest, handleRequestLogin]);

  const handleNavigateToSuperconcept = useCallback((comboId, comboName) => {
    handleSubscribeToCombo(comboId, comboName || '');
  }, [handleSubscribeToCombo]);

  const handleUnsubscribeFromCombo = useCallback(async (comboId) => {
    try {
      await combosAPI.unsubscribe(comboId);
      setComboSubscriptions(prev => {
        const remaining = prev.filter(s => s.id !== comboId);
        if (activeTab?.type === 'combo' && activeTab?.id === comboId) {
          if (graphTabs.length > 0) {
            setActiveTab({ type: 'graph', id: graphTabs[0].id });
          } else if (remaining.length > 0) {
            setActiveTab({ type: 'combo', id: remaining[0].id });
          } else {
            createDefaultGraphTab();
          }
        }
        return remaining;
      });
      await refreshSidebarItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unsubscribe');
    }
  }, [activeTab, graphTabs]);

  // ─── Tab Group Actions (Phase 5d) ─────────────────────────

  const handleCreateGroup = async (name) => {
    try {
      const res = await votesAPI.createTabGroup(name || 'Group');
      const newGroup = res.data.tabGroup;
      setTabGroups(prev => [...prev, newGroup]);
      await refreshSidebarItems();
      return newGroup;
    } catch (err) {
      console.error('Failed to create tab group:', err);
      return null;
    }
  };

  const handleRenameGroup = async () => {
    const name = groupRenameValue.trim();
    if (!name || !renamingGroupId) return;
    try {
      await votesAPI.renameTabGroup(renamingGroupId, name);
      setTabGroups(prev => prev.map(g =>
        g.id === renamingGroupId ? { ...g, name } : g
      ));
      setRenamingGroupId(null);
      setGroupRenameValue('');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename group');
    }
  };

  const handleGroupRenameKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameGroup();
    if (e.key === 'Escape') { setRenamingGroupId(null); setGroupRenameValue(''); }
  };

  const handleDeleteGroup = async (groupId) => {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    if (!window.confirm(`Delete group "${group.name}"? Tabs inside will become ungrouped.`)) return;
    try {
      await votesAPI.deleteTabGroup(groupId);
      setTabGroups(prev => prev.filter(g => g.id !== groupId));
      // Ungroup all graph tabs that were in this group
      setGraphTabs(prev => prev.map(t =>
        t.group_id === groupId ? { ...t, group_id: null } : t
      ));
      await refreshSidebarItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete group');
    }
  };

  const handleToggleGroup = async (groupId) => {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    const newExpanded = !group.is_expanded;
    // Optimistic update
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, is_expanded: newExpanded } : g
    ));
    try {
      await votesAPI.toggleTabGroup(groupId, newExpanded);
    } catch (err) {
      // Revert on failure
      setTabGroups(prev => prev.map(g =>
        g.id === groupId ? { ...g, is_expanded: !newExpanded } : g
      ));
    }
  };

  const handleAddTabToGroup = async (tabType, tabId, groupId) => {
    try {
      await votesAPI.addTabToGroup(tabType, tabId, groupId);
      if (tabType === 'corpus') {
        setCorpusTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: groupId } : t
        ));
      } else if (tabType === 'combo') {
        setComboSubscriptions(prev => prev.map(c =>
          c.id === tabId ? { ...c, group_id: groupId } : c
        ));
      } else {
        setGraphTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: groupId } : t
        ));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add tab to group');
    }
  };

  const handleRemoveTabFromGroup = async (tabType, tabId) => {
    try {
      await votesAPI.removeTabFromGroup(tabType, tabId);
      if (tabType === 'corpus') {
        setCorpusTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: null } : t
        ));
      } else if (tabType === 'combo') {
        setComboSubscriptions(prev => prev.map(c =>
          c.id === tabId ? { ...c, group_id: null } : c
        ));
      } else {
        setGraphTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: null } : t
        ));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove tab from group');
    }
  };

  // Create a new group and immediately add the right-clicked tab to it
  const handleGroupFromContextMenu = async (tabType, tabId) => {
    const groupName = window.prompt('Group name:');
    if (!groupName?.trim()) return;
    const group = await handleCreateGroup(groupName.trim());
    if (group) {
      await handleAddTabToGroup(tabType, tabId, group.id);
    }
  };

  // ─── Context Menu ───────────────────────────────────────

  const handleTabContextMenu = (e, tabType, tabId) => {
    e.preventDefault();
    const menuWidth = 240;
    const menuHeight = 200;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ x, y, tabType, tabId });
  };

  const handleGroupContextMenu = (e, groupId) => {
    e.preventDefault();
    const menuWidth = 240;
    const menuHeight = 150;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ x, y, groupId, tabType: 'group' });
  };

  const handleContextMenuAction = (action) => {
    if (!contextMenu) return;
    const { tabType, tabId, groupId } = contextMenu;

    if (action === 'duplicate' && tabType === 'graph') {
      handleDuplicateGraphTab(tabId);
    } else if (action === 'newWindow') {
      if (tabType === 'graph') {
        const tab = graphTabs.find(t => t.id === tabId);
        if (tab) {
          const url = tab.concept_id
            ? `/concept/${tab.concept_id}${tab.path?.length ? '?path=' + tab.path.join(',') : ''}`
            : '/';
          window.open(url, '_blank');
        }
      }
    } else if (action === 'close' && tabType === 'graph') {
      handleCloseGraphTab(tabId);
    } else if (action === 'createGroup') {
      handleGroupFromContextMenu(tabType, tabId);
    } else if (action === 'addToGroup') {
      if (tabGroups.length === 0) {
        handleGroupFromContextMenu(tabType, tabId);
      } else {
        const groupNames = tabGroups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
        const choice = window.prompt(`Add to which group?\n${groupNames}\n\nEnter number (or type a new name to create):`);
        if (!choice?.trim()) { setContextMenu(null); return; }
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < tabGroups.length) {
          handleAddTabToGroup(tabType, tabId, tabGroups[idx].id);
        } else {
          handleCreateGroup(choice.trim()).then(group => {
            if (group) handleAddTabToGroup(tabType, tabId, group.id);
          });
        }
      }
    } else if (action === 'removeFromGroup') {
      handleRemoveTabFromGroup(tabType, tabId);
    } else if (action === 'renameGroup' && tabType === 'group') {
      setRenamingGroupId(groupId);
      const group = tabGroups.find(g => g.id === groupId);
      setGroupRenameValue(group?.name || '');
    } else if (action === 'deleteGroup' && tabType === 'group') {
      handleDeleteGroup(groupId);
    }

    setContextMenu(null);
  };

  // ─── Tab Bar Layout Logic ──────────────────────────────

  // Check if a group contains the active tab
  const groupContainsActiveTab = (group) => {
    if (!activeTab) return false;
    if (activeTab.type === 'graph') {
      return graphTabs.some(t => t.id === activeTab.id && t.group_id === group.id);
    }
    if (activeTab.type === 'combo') {
      return comboSubscriptions.some(c => c.id === activeTab.id && c.group_id === group.id);
    }
    return false;
  };

  // ─── Render ─────────────────────────────────────────────

  const isActiveTab = (type, id) =>
    activeTab?.type === type && activeTab?.id === id;

  if (loading || authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  // Sidebar: Graph tabs split by group membership (used by guest mode + group rendering)
  const ungroupedGraphTabs = graphTabs.filter(t => !t.group_id);

  // DnD: top-level items and their sortable IDs (Phase 19c)
  const topLevelSidebarItems = sidebarItems.filter(item => {
    if (item.item_type === 'graph_tab') {
      return !graphTabs.find(t => t.id === item.item_id)?.group_id;
    }
    if (item.item_type === 'combo') {
      return !comboSubscriptions.find(c => c.id === item.item_id)?.group_id;
    }
    return true;
  });
  const topLevelSortableIds = topLevelSidebarItems.map(i => i.id);

  // Drag overlay ghost
  const activeDragItem = activeDragId != null ? sidebarItems.find(i => i.id === activeDragId) : null;
  const activeDragLabel = activeDragItem
    ? activeDragItem.item_type === 'combo' ? comboSubscriptions.find(c => c.id === activeDragItem.item_id)?.name
    : activeDragItem.item_type === 'group' ? tabGroups.find(g => g.id === activeDragItem.item_id)?.name
    : activeDragItem.item_type === 'graph_tab' ? graphTabs.find(t => t.id === activeDragItem.item_id)?.label
    : null
    : null;
  const activeDragOverlay = activeDragLabel ? (
    <div style={styles.dragOverlay}>{activeDragLabel}</div>
  ) : null;

  // Render a sidebar item for a combo tab (Phase 39b)
  const renderSidebarComboItem = (combo) => {
    const isActive = isActiveTab('combo', combo.id);

    return (
      <div
        key={`combo-${combo.id}`}
        style={{
          ...styles.sidebarItem,
          ...(isActive ? styles.sidebarItemActive : {}),
        }}
        onClick={() => {
          setActiveTab({ type: 'combo', id: combo.id });
         
          setComboView(null);
          setSavedPageOpen(false);
         
         
        }}
        onContextMenu={(e) => handleTabContextMenu(e, 'combo', combo.id)}
        title={`${combo.name} — right-click for options`}
      >
        <span style={styles.sidebarArrowPlaceholder} />
        <span style={styles.sidebarItemLabel}>{combo.name}</span>
      </div>
    );
  };

  // Render a sidebar item for a graph tab
  const renderSidebarGraphItem = (tab, depth = 0) => {
    const isActive = isActiveTab('graph', tab.id);

    return (
      <div
        key={`graph-${tab.id}`}
        style={{
          ...styles.sidebarItem,
          paddingLeft: `${12 + depth * 16}px`,
          ...(isActive ? styles.sidebarItemActive : {}),
        }}
        onClick={() => { setActiveTab({ type: 'graph', id: tab.id }); setComboView(null); setSavedPageOpen(false); }}
        onContextMenu={(e) => handleTabContextMenu(e, 'graph', tab.id)}
        title={`${tab.label} — right-click for options`}
      >
        <span style={styles.sidebarArrowPlaceholder} />
        <span style={styles.sidebarGraphIcon}>⬡</span>
        <span style={styles.sidebarItemLabel}>{tab.label}</span>
        <button
          style={styles.sidebarCloseButton}
          onClick={(e) => { e.stopPropagation(); handleCloseGraphTab(tab.id); }}
          title="Close tab"
        >{'\u2715'}</button>
      </div>
    );
  };

  // Render a sidebar group. sidebarItemId is the sidebar_items.id for DnD.
  const renderSidebarGroup = (group, sidebarItemId = null) => {
    const isExpanded = group.is_expanded;
    const memberGraph = graphTabs.filter(t => t.group_id === group.id);
    const memberCombos = comboSubscriptions.filter(c => c.group_id === group.id);
    // Sidebar item IDs for member graph tabs (for the inner SortableContext)
    const memberGraphSidebarIds = memberGraph
      .map(tab => sidebarItems.find(si => si.item_type === 'graph_tab' && si.item_id === tab.id)?.id)
      .filter(Boolean);
    const hasActiveInside = groupContainsActiveTab(group);
    const memberCount = memberGraph.length + memberCombos.length;
    // Amber highlight when a graph_tab is dragged over this group
    const isDropTarget = overGroupItemId != null && overGroupItemId === sidebarItemId;

    const renderHeader = (dragHandleProps = {}) => (
      <div
        {...dragHandleProps}
        style={{
          ...styles.sidebarItem,
          ...styles.sidebarGroupHeader,
          ...(hasActiveInside && !isExpanded ? styles.sidebarItemActive : {}),
          ...(isDropTarget ? styles.sidebarDropTarget : {}),
        }}
        onClick={() => handleToggleGroup(group.id)}
        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
        onDoubleClick={() => {
          setRenamingGroupId(group.id);
          setGroupRenameValue(group.name);
        }}
        title={`${group.name} (${memberCount} tab${memberCount !== 1 ? 's' : ''}) — right-click for options`}
      >
        <span style={styles.sidebarArrow}>{isExpanded ? '▾' : '▸'}</span>
        {renamingGroupId === group.id ? (
          <input
            ref={groupRenameInputRef}
            value={groupRenameValue}
            onChange={(e) => setGroupRenameValue(e.target.value)}
            onKeyDown={handleGroupRenameKeyDown}
            onBlur={handleRenameGroup}
            onClick={(e) => e.stopPropagation()}
            style={styles.sidebarRenameInput}
            maxLength={255}
          />
        ) : (
          <>
            <span style={styles.sidebarItemLabel}>{group.name}</span>
            <span style={styles.sidebarGroupCount}>{memberCount}</span>
          </>
        )}
      </div>
    );

    const renderMembers = (withDnd) => (
      <>
        {/* Combo members in group (not DnD-sortable within group) */}
        {memberCombos.map(combo => (
          <div key={`combo-g-${combo.id}`} style={{ paddingLeft: '16px' }}>
            {renderSidebarComboItem(combo)}
          </div>
        ))}
        {/* Graph tab members in group */}
        {withDnd && memberGraphSidebarIds.length > 0 ? (
          <GroupMemberContext ids={memberGraphSidebarIds}>
            {memberGraph.map(tab => {
              const si = sidebarItems.find(s => s.item_type === 'graph_tab' && s.item_id === tab.id);
              if (!si) return renderSidebarGraphItem(tab, 1);
              return (
                <SortableItem key={si.id} id={si.id}>
                  {renderSidebarGraphItem(tab, 1)}
                </SortableItem>
              );
            })}
          </GroupMemberContext>
        ) : (
          memberGraph.map(tab => renderSidebarGraphItem(tab, 1))
        )}
      </>
    );

    if (sidebarItemId != null) {
      return (
        <SortableGroupWrapper key={`group-${group.id}`} id={sidebarItemId}>
          {({ dragHandleProps }) => (
            <div>
              {renderHeader(dragHandleProps)}
              {isExpanded && renderMembers(true)}
            </div>
          )}
        </SortableGroupWrapper>
      );
    }
    return (
      <div key={`group-${group.id}`}>
        {renderHeader()}
        {isExpanded && renderMembers(false)}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.titleRow}>
            <h1 style={styles.title} onClick={() => navigate('/')} role="button" tabIndex={0}>orca</h1>
            <button style={{ ...styles.navLink, ...(infoSlug === 'the-storm' ? styles.navLinkActive : {}) }} onClick={() => navigate('/the-storm')}>The Categorical Storm</button>
            <button style={{ ...styles.navLink, ...(infoSlug === 'using-orca' ? styles.navLinkActive : {}) }} onClick={() => navigate('/using-orca')}>Using orca</button>
            {!isOutreachMode && <button style={{ ...styles.navLink, ...(isLegalPage ? styles.navLinkActive : {}) }} onClick={() => navigate('/legal')}>Legal/Copyright Info</button>}
          </div>
          {isOutreachMode ? null : isGuest ? (
            <div style={styles.userSection}>
              <button onClick={() => { setLoginModalTab('login'); setLoginModalNotice(''); setShowLoginModal(true); }} style={styles.loginButton}>Log in</button>
              <button onClick={() => { setLoginModalTab('signup'); setLoginModalNotice(''); setShowLoginModal(true); }} style={styles.signupButton}>Sign up</button>
            </div>
          ) : (
            <div style={styles.userSection}>
              <span
                style={styles.username}
                onClick={() => navigate(`/profile/${user?.id}`)}
                role="button"
                tabIndex={0}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
              >{user?.username}</span>
              <div ref={accountMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowAccountMenu(prev => !prev)}
                  style={styles.logoutButton}
                >
                  Log out ▾
                </button>
                {showAccountMenu && (
                  <div style={styles.accountDropdown}>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); logout(); }}
                    >Log out</button>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); logoutEverywhere(); }}
                    >Log out everywhere</button>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); setShowDeleteFlow(true); }}
                    >Delete account</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Phase 65a: Unavailable link toast */}
      {unavailableLinkToast && (
        <div style={styles.unavailableLinkToast}>That link is no longer available.</div>
      )}

      {/* Phase 30g: Info pages replace normal layout */}
      {/* Legal pages also replace normal layout */}
      {infoSlug || isLegalPage ? (
        <div style={styles.mainLayout}>
          <div style={styles.contentArea}>
            {infoSlug === 'the-storm' && <TheStormPage />}
            {infoSlug && infoSlug !== 'the-storm' && <InfoPage slug={infoSlug} onRequestLogin={handleRequestLogin} />}
            {location.pathname === '/legal' && <LegalPage />}
            {location.pathname === '/terms' && <TermsPage />}
            {location.pathname === '/privacy' && <PrivacyPage />}
            {location.pathname === '/copyright' && <CopyrightPage />}
            {location.pathname === '/copyright-policy' && <CopyrightPolicyPage />}
            {location.pathname === '/report-infringement' && <InfringementNoticePage />}
            {location.pathname === '/counter-notice' && <CounterNoticePage />}

            {location.pathname === '/admin/legal' && <AdminLegalRemovalsPanel />}
          </div>
        </div>
      ) : isOutreachMode ? (
      <div style={styles.mainLayout}>
        <div style={styles.contentArea}>
          <OutreachLanding />
        </div>
      </div>
      ) : (
      /* Main layout: Sidebar + Content */
      <div style={styles.mainLayout}>
        {/* ─── Sidebar ─── */}
        {!sidebarCollapsed && (
          <nav style={styles.sidebar}>
            {/* Action buttons at top */}
            <div style={styles.sidebarActions}>
              {!isGuest && (
                <button
                  onClick={() => { setComboView(null); setVotesOpen(true); }}
                  style={styles.sidebarActionButton}
                  title="View your saved concepts and upvoted links"
                >Votes</button>
              )}
              <button
                onClick={() => { setVotesOpen(false); setComboView({ view: 'list' }); }}
                style={styles.sidebarActionButton}
                title="Browse and manage superconcepts"
              >Browse Superconcepts</button>
            </div>

            <div style={styles.sidebarDivider} />

            {/* Scrollable tree area */}
            <div style={styles.sidebarTree}>
              {isGuest ? (
                // Guests: simple ephemeral graph tab list (no DnD)
                ungroupedGraphTabs.map(tab => renderSidebarGraphItem(tab))
              ) : sidebarItems.length > 0 ? (
                // Logged in with sidebar order: DnD-enabled unified list
                <SidebarDndContext
                  topLevelIds={topLevelSortableIds}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  overlayContent={activeDragOverlay}
                >
                  {topLevelSidebarItems.map(item => {
                    if (item.item_type === 'group') {
                      const group = tabGroups.find(g => g.id === item.item_id);
                      if (!group) return null;
                      return renderSidebarGroup(group, item.id);
                    }
                    if (item.item_type === 'combo') {
                      const combo = comboSubscriptions.find(c => c.id === item.item_id);
                      if (!combo) return null;
                      return (
                        <SortableItem key={item.id} id={item.id}>
                          {renderSidebarComboItem(combo)}
                        </SortableItem>
                      );
                    }
                    if (item.item_type === 'graph_tab') {
                      const tab = graphTabs.find(t => t.id === item.item_id);
                      if (!tab || tab.group_id) return null;
                      return (
                        <SortableItem key={item.id} id={item.id}>
                          {renderSidebarGraphItem(tab)}
                        </SortableItem>
                      );
                    }
                    return null;
                  })}
                </SidebarDndContext>
              ) : (
                // Fallback: sidebar order not loaded, render without DnD
                [
                  ...comboSubscriptions.map(c => ({ item_type: 'combo', item_id: c.id, _key: `cb-${c.id}` })),
                  ...tabGroups.map(g => ({ item_type: 'group', item_id: g.id, _key: `g-${g.id}` })),
                  ...graphTabs.filter(t => !t.group_id).map(t => ({ item_type: 'graph_tab', item_id: t.id, _key: `gt-${t.id}` })),
                ].map(item => {
                  if (item.item_type === 'combo') return renderSidebarComboItem(comboSubscriptions.find(c => c.id === item.item_id));
                  if (item.item_type === 'group') return renderSidebarGroup(tabGroups.find(g => g.id === item.item_id));
                  if (item.item_type === 'graph_tab') return renderSidebarGraphItem(graphTabs.find(t => t.id === item.item_id));
                  return null;
                })
              )}

              {/* New graph tab button */}
              <button
                style={styles.sidebarNewTabButton}
                onClick={handleCreateGraphTab}
                title="Open a new graph tab"
              >+ New graph</button>
            </div>

            {/* Collapse sidebar button */}
            <div style={styles.sidebarFooter}>
              <button
                onClick={() => setSidebarCollapsed(true)}
                style={styles.sidebarCollapseButton}
                title="Collapse sidebar"
              >« Hide</button>
            </div>
          </nav>
        )}

        {/* Collapsed sidebar toggle */}
        {sidebarCollapsed && (
          <div style={styles.sidebarCollapsedBar}>
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={styles.sidebarExpandButton}
              title="Expand sidebar"
            >»</button>
          </div>
        )}

        {/* ─── Content Area ─── */}
        <div style={styles.contentArea}>
          {/* Phase 59b: Unified Votes overlay */}
          {votesOpen && (
            <VotesOverlay
              onBack={() => setVotesOpen(false)}
              onOpenConceptTab={handleOpenConceptTab}
              onNavigateToLink={(conceptId, path, conceptName, attributeName, scrollToLinkId) => {
                setVotesOpen(false);
                handleOpenConceptTab(conceptId, path, conceptName, attributeName, undefined, 'children', scrollToLinkId);
              }}
            />
          )}

          {/* Phase 39b: Browse Combos overlay */}
          {!votesOpen && comboView && comboView.view === 'list' && (
            <ComboListView
              onBack={() => setComboView(null)}
              isGuest={isGuest}
              comboSubscriptions={comboSubscriptions}
              onSubscribe={() => reloadComboSubscriptions()}
              onUnsubscribe={(comboId) => handleUnsubscribeFromCombo(comboId)}
              onComboClick={(combo) => {
                handleSubscribeToCombo(combo.id, combo.name);
              }}
              onRequestLogin={() => {
                setLoginModalTab('login');
                setLoginModalNotice('Log in to subscribe to superconcepts');
                setShowLoginModal(true);
              }}
            />
          )}

          {/* Guest deep-link combo view */}
          {!votesOpen && !comboView && guestComboId && (
            <div>
              <div style={{ padding: '12px 20px 0', fontFamily: '"EB Garamond", Georgia, serif' }}>
                <span onClick={() => setGuestComboId(null)} style={{ cursor: 'pointer', color: '#888', fontSize: '14px', textDecoration: 'underline' }}>{'\u2190'} Back</span>
              </div>
              <ComboTabContent
                comboId={guestComboId}
                user={user}
                isGuest={true}
                onRequestLogin={handleRequestLogin}
                onOpenConceptTab={handleOpenConceptTab}
              />
            </div>
          )}

          {/* Normal tab content — hidden when overlays are active */}
          {!votesOpen && !comboView && !guestComboId && (
            <>
              {/* Combo tab content — render all, hide inactive to preserve state */}
              {!isGuest && comboSubscriptions.map(combo => {
                const isActive = activeTab?.type === 'combo' && activeTab?.id === combo.id;
                return (
                  <div
                    key={`combo-${combo.id}`}
                    style={isActive ? styles.tabPane : styles.tabPaneHidden}
                  >
                    <ComboTabContent
                      comboId={combo.id}
                      user={user}
                      isGuest={isGuest}
                      onUnsubscribe={handleUnsubscribeFromCombo}
                      onRequestLogin={handleRequestLogin}
                      onOpenConceptTab={handleOpenConceptTab}
                      refreshKey={comboRefreshKey}
                    />
                  </div>
                );
              })}
              {/* Render all graph tabs; hide inactive to preserve nav history */}
              {graphTabs.map(tab => {
                const isActive = activeTab?.type === 'graph' && activeTab?.id === tab.id;
                return (
                  <div
                    key={`graph-${tab.id}`}
                    style={isActive ? styles.tabPane : styles.tabPaneHidden}
                  >
                    {tab.tab_type === 'root' && !tab.concept_id ? (
                      <Root
                        graphTabId={tab.id}
                        onNavigate={handleGraphTabNavigate}
                        isGuest={isGuest}
                      />
                    ) : (
                      <Concept
                        graphTabId={tab.id}
                        initialConceptId={tab.concept_id}
                        initialPath={tab.path || []}
                        initialViewMode={tab.view_mode || 'children'}
                        onNavigate={handleGraphTabNavigate}
                        isGuest={isGuest}
                        onOpenConceptTab={handleOpenConceptTab}
                        onRequestLogin={handleRequestLogin}
                        onNavigateToSuperconcept={handleNavigateToSuperconcept}
                        ownedCombos={ownedCombos}
                        onComboEdgeAdded={() => setComboRefreshKey(k => k + 1)}
                        pendingScrollLinkId={isActive ? pendingScrollLinkId : null}
                        onPendingScrollLinkConsumed={() => setPendingScrollLinkId(null)}
                        pendingScrollTunnelLinkId={isActive ? pendingScrollTunnelLinkId : null}
                        onPendingScrollTunnelLinkConsumed={() => setPendingScrollTunnelLinkId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Graph tab context menu */}
          {contextMenu.tabType === 'graph' && (
            <>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('duplicate')}
              >Duplicate tab</button>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('newWindow')}
              >Open in new window</button>
              <div style={styles.contextMenuDivider} />
              {graphTabs.find(t => t.id === contextMenu.tabId)?.group_id ? (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction('removeFromGroup')}
                >Remove from group</button>
              ) : (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction(tabGroups.length > 0 ? 'addToGroup' : 'createGroup')}
                >{tabGroups.length > 0 ? 'Add to group...' : 'Create group with this tab...'}</button>
              )}
              <div style={styles.contextMenuDivider} />
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => handleContextMenuAction('close')}
              >Close tab</button>
            </>
          )}

          {/* Combo tab context menu — unsubscribe + group management */}
          {contextMenu.tabType === 'combo' && (
            <>
              {comboSubscriptions.find(c => c.id === contextMenu.tabId)?.group_id ? (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction('removeFromGroup')}
                >Remove from group</button>
              ) : (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction(tabGroups.length > 0 ? 'addToGroup' : 'createGroup')}
                >{tabGroups.length > 0 ? 'Add to group...' : 'Create group with this tab...'}</button>
              )}
              <div style={styles.contextMenuDivider} />
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => { handleUnsubscribeFromCombo(contextMenu.tabId); setContextMenu(null); }}
              >Unsubscribe</button>
            </>
          )}

          {/* Group context menu */}
          {contextMenu.tabType === 'group' && (
            <>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('renameGroup')}
              >Rename group</button>
              <div style={styles.contextMenuDivider} />
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => handleContextMenuAction('deleteGroup')}
              >Delete group (keeps tabs)</button>
            </>
          )}
        </div>
      )}

      {/* Phase 28f: Login/Signup Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => { setShowLoginModal(false); setPendingOrcidData(null); }}
        initialTab={loginModalTab}
        notice={loginModalNotice}
        pendingOrcidData={pendingOrcidData}
        onClearPendingOrcid={() => setPendingOrcidData(null)}
      />

      {/* Phase 35d: Delete Account Flow */}
      {showDeleteFlow && (
        <DeleteAccountFlow onClose={() => setShowDeleteFlow(false)} />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#faf9f7',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    backgroundColor: 'white',
    borderBottom: '1px solid #eee',
    padding: '10px 20px',
    flexShrink: 0,
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    cursor: 'pointer',
  },
  navLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    padding: '2px 4px',
  },
  navLinkActive: {
    color: '#333',
    fontWeight: '600',
  },
  userSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  username: {
    fontSize: '14px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
    cursor: 'pointer',
  },
  logoutButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  accountDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    backgroundColor: '#faf9f6',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    zIndex: 9999,
    minWidth: '170px',
    overflow: 'hidden',
  },
  accountDropdownItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #eee',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  loginButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  signupButton: {
    padding: '6px 14px',
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },

  // ─── Main Layout (Sidebar + Content) ──────────
  mainLayout: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
  },

  // ─── Sidebar ──────────────────────────────────
  sidebar: {
    width: '220px',
    flexShrink: 0,
    backgroundColor: 'white',
    borderRight: '1px solid #e8e6e2',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 10px 6px 10px',
  },
  sidebarActionButton: {
    flex: 1,
    padding: '6px 8px',
    backgroundColor: 'transparent',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    textAlign: 'center',
  },
  sidebarDivider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '6px 10px',
  },
  sidebarTree: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '0 0 8px 0',
  },

  // Sidebar items (shared by corpus, graph, group headers)
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 10px 5px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    position: 'relative',
    borderLeft: '3px solid transparent',
    gap: '4px',
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    color: '#333',
    fontWeight: '600',
    borderLeftColor: '#333',
  },
  sidebarArrow: {
    fontSize: '9px',
    width: '12px',
    textAlign: 'center',
    flexShrink: 0,
    cursor: 'pointer',
    color: '#999',
  },
  sidebarArrowPlaceholder: {
    width: '12px',
    flexShrink: 0,
  },
  sidebarCorpusIcon: {
    fontSize: '12px',
    flexShrink: 0,
  },
  sidebarGraphIcon: {
    fontSize: '11px',
    flexShrink: 0,
    color: '#999',
  },
  sidebarItemLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sidebarCloseButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '9px',
    color: '#ccc',
    padding: '2px 4px',
    lineHeight: 1,
    borderRadius: '2px',
    flexShrink: 0,
    opacity: 0.6,
  },
  sidebarGroupHeader: {
    fontWeight: '500',
  },
  sidebarGroupCount: {
    fontSize: '10px',
    color: '#bbb',
    marginLeft: '4px',
    fontWeight: '400',
    flexShrink: 0,
  },
  sidebarRenameInput: {
    flex: 1,
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '3px',
    padding: '2px 6px',
    outline: 'none',
  },
  sidebarNewTabButton: {
    display: 'block',
    width: '100%',
    padding: '6px 12px 6px 28px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
    textAlign: 'left',
  },
  // DnD drop target highlight (Phase 19c)
  sidebarDropTarget: {
    backgroundColor: 'rgba(232, 217, 160, 0.5)',
    borderRadius: '4px',
  },
  // DnD drag overlay ghost (Phase 19c)
  dragOverlay: {
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#444',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'grabbing',
  },
  sidebarFooter: {
    borderTop: '1px solid #eee',
    padding: '6px 10px',
    flexShrink: 0,
  },
  sidebarCollapseButton: {
    display: 'block',
    width: '100%',
    padding: '4px 8px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
    textAlign: 'center',
  },

  // Collapsed sidebar
  sidebarCollapsedBar: {
    width: '24px',
    flexShrink: 0,
    backgroundColor: 'white',
    borderRight: '1px solid #e8e6e2',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '10px',
  },
  sidebarExpandButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#bbb',
    padding: '4px 2px',
    lineHeight: 1,
  },

  // ─── Content Area ──────────────────────────────
  contentArea: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
  },
  tabPane: {
    display: 'block',
    height: '100%',
  },
  tabPaneHidden: {
    display: 'none',
  },

  // ─── Context Menu ──────────────────────────────
  contextMenu: {
    position: 'fixed',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    padding: '4px 0',
    zIndex: 9999,
    minWidth: '220px',
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    textAlign: 'left',
  },
  contextMenuDivider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '4px 0',
  },

  loading: {
    textAlign: 'center',
    padding: '80px',
    fontSize: '16px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unavailableLinkToast: {
    padding: '10px 20px',
    backgroundColor: '#f5f0ea',
    borderBottom: '1px solid #d4d0c8',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    textAlign: 'center',
  },
};

export default AppShell;
