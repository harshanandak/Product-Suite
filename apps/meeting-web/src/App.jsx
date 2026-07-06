import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { MeetingHistory } from "@/components/MeetingHistory";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useBuddyAgent } from "@/hooks/useBuddyAgent";
import { useMeetingState } from "@/hooks/useMeetingState";
import { resolveHostedWorkspaceStage } from "@/lib/hostedWorkspace";
import {
  performHostedSignOutFlow,
  retryHostedOnboardingFlow,
} from "@/lib/hostedAuthFlow";
import {
  HOSTED_AUTH_SIGN_IN_PATH,
  clearHostedPostLoginPath,
  sanitizeSameOriginPath,
  setHostedPostLoginPath,
} from "@/lib/hostedAuthRoutes";
import { MeetingCreateScreen } from "@/components/meeting/MeetingCreateScreen";
import { SummaryFirstMeetingScreen } from "@/components/meeting/SummaryFirstMeetingScreen";
import { AppShell } from "@/layouts/AppShell";
import { syncSummaryStateAfterTranscriptionChunk } from "@/lib/transcriptionSync";
import {
  acceptOrganizationInvite,
  clearAuthToken,
  createMeeting,
  createOrganization,
  deleteMeeting,
  getCachedRuntimeConfig,
  getCurrentUser,
  getHealth,
  getMeeting,
  getOnboardingState,
  getStoredAuthToken,
  getSummary,
  getTranscript,
  initializeRuntimeConfig,
  listEngines,
  listMeetings,
  searchTranscripts,
  sendChatMessage,
  setAuthToken,
  signOutHostedSession,
  transcribeAudio,
  updateMeeting,
  getChatHistory,
} from "@/lib/api";

function mergeSegmentsById(previousSegments, nextSegments) {
  const merged = new Map(previousSegments.map((segment) => [segment.id, segment]));

  nextSegments.forEach((segment) => {
    if (!segment?.id) {
      return;
    }
    merged.set(segment.id, {
      ...(merged.get(segment.id) || {}),
      ...segment,
    });
  });

  return Array.from(merged.values()).sort(
    (left, right) => (left.timestamp_start || 0) - (right.timestamp_start || 0)
  );
}

function describeRequestError(error, fallbackMessage) {
  return error?.response?.data?.detail || error?.message || fallbackMessage;
}

function extensionForAudioBlob(blob) {
  const type = blob?.type || "";
  if (type.includes("ogg")) {
    return "ogg";
  }
  if (type.includes("wav")) {
    return "wav";
  }
  if (type.includes("mpeg") || type.includes("mp3")) {
    return "mp3";
  }
  if (type.includes("mp4")) {
    return "mp4";
  }
  if (type.includes("webm")) {
    return "webm";
  }
  return "webm";
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { meetingId: routeMeetingId = null } = useParams();

  const resolveMicPermissionMessage = (error) => {
    const name = error?.name || error?.code || "UNKNOWN";
    const detail = error?.message ? ` (${error.message})` : "";

    if (name === "NotAllowedError") {
      return `Microphone permission is blocked${detail}. Open browser site settings for this page and allow microphone access, then retry.`;
    }

    if (name === "NotFoundError") {
      return `No microphone was detected${detail}. Connect a mic and refresh the page.`;
    }

    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The microphone is busy or not accessible. Close other apps using the mic and retry.";
    }

    if (name === "NotSupportedError" || name === "OverconstrainedError") {
      return "Your browser could not satisfy the requested microphone settings. Retry with different input.";
    }

    if (name === "SecurityError") {
      return `Microphone access is blocked due to security context${detail}. Open this app on http://localhost or HTTPS.`;
    }

    if (name === "TypeError" && /permission/i.test(error?.message || "")) {
      return `Permission API blocked by browser${detail}. Open browser settings and ensure microphone access is allowed for localhost:3000.`;
    }

    return `Failed to start recording. Check microphone permissions and device availability.${detail ? ` ${detail}` : ""}`;
  };

  const [runtimeConfig, setRuntimeConfig] = useState(getCachedRuntimeConfig());
  const [bootstrapStatus, setBootstrapStatus] = useState("loading");
  const [bootstrapError, setBootstrapError] = useState("");
  const [authStatus, setAuthStatus] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [onboardingStatus, setOnboardingStatus] = useState("idle");
  const [onboardingError, setOnboardingError] = useState("");
  const [onboardingNotice, setOnboardingNotice] = useState("");
  const [isOnboardingSubmitting, setIsOnboardingSubmitting] = useState(false);
  const [onboardingMode, setOnboardingMode] = useState("create");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [engineStatus, setEngineStatus] = useState({
    whisper: "loading",
    sarvam: "loading",
  });
  const [meetings, setMeetings] = useState([]);
  const [activeMeetingId, setActiveMeetingId] = useState(null);
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [, setSegments] = useState([]);
  const [, setSummary] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [, setIsTranscribing] = useState(false);
  const [draftMeetingTitle, setDraftMeetingTitle] = useState("");
  const [draftMeetingEngine, setDraftMeetingEngine] = useState("");
  const [hasChosenDraftMeetingEngine, setHasChosenDraftMeetingEngine] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);

  const currentPath = location.pathname || "/";
  const isHostedMode = runtimeConfig?.deployment_mode === "hosted";
  const authRequired = Boolean(runtimeConfig?.auth?.required);
  const canUseWorkspace = authStatus === "authenticated" && onboardingStatus === "complete";
  const hostedWorkspaceStage = resolveHostedWorkspaceStage({
    bootstrapStatus,
    isHostedMode,
    authRequired,
    authStatus,
    onboardingStatus,
  });
  const summaryState = useMeetingState(activeMeetingId, {
    enabled: bootstrapStatus === "ready" && canUseWorkspace,
  });
  const refreshMeetingState = summaryState.refresh;
  const buddyAgent = useBuddyAgent(activeMeetingId);
  const engineAvailability = {
    whisper: {
      state: engineStatus.whisper,
      available: engineStatus.whisper === "available",
    },
    sarvam: {
      state: engineStatus.sarvam,
      available: engineStatus.sarvam === "available",
    },
  };
  const defaultEngine = engineAvailability.whisper.available
    ? "whisper"
    : engineAvailability.sarvam.available
      ? "sarvam"
      : "whisper";
  const activeEngineAvailable =
    !activeMeeting || engineAvailability?.[activeMeeting.engine]?.available === true;

  useEffect(() => {
    if (!hasChosenDraftMeetingEngine) {
      setDraftMeetingEngine(defaultEngine);
    }
  }, [defaultEngine, hasChosenDraftMeetingEngine]);

  const handleDraftMeetingEngineChange = useCallback((nextEngine) => {
    setDraftMeetingEngine(nextEngine);
    setHasChosenDraftMeetingEngine(true);
  }, []);

  const replaceBrowserPath = useCallback(
    (nextPath) => {
      const resolvedPath = sanitizeSameOriginPath(nextPath, "/");
      navigate(resolvedPath, { replace: true });
    },
    [navigate]
  );

  const pushBrowserPath = useCallback(
    (nextPath) => {
      const resolvedPath = sanitizeSameOriginPath(nextPath, "/");
      navigate(resolvedPath);
    },
    [navigate]
  );

  const resetLocalSession = useCallback(() => {
    clearAuthToken();
    setCurrentUser(null);
    setAuthStatus("anonymous");
    setOnboardingStatus("idle");
    setOnboardingError("");
    setOnboardingNotice("");
  }, []);

  const resetWorkspaceState = useCallback(() => {
    setMeetings([]);
    setActiveMeetingId(null);
    setActiveMeeting(null);
    setSegments([]);
    setSummary(null);
    setChatMessages([]);
  }, []);

  const loadProviderStatus = useCallback(async () => {
    const nextStatus = {
      whisper: "error",
      sarvam: "error",
    };

    const [enginesResult, healthResult] = await Promise.allSettled([listEngines(), getHealth()]);

    if (enginesResult.status === "fulfilled") {
      const engines = enginesResult.value.data?.engines || [];
      engines.forEach((engine) => {
        if (!engine?.id) {
          return;
        }
        if (typeof engine.status === "string") {
          nextStatus[engine.id] = engine.status;
          return;
        }
        if (typeof engine.available === "boolean") {
          nextStatus[engine.id] = engine.available ? "available" : "unavailable";
        }
      });
    }

    if (healthResult.status === "fulfilled") {
      const health = healthResult.value.data || {};
      if (nextStatus.whisper === "error" && typeof health.openai_configured === "boolean") {
        nextStatus.whisper = health.openai_configured ? "available" : "unavailable";
      }
      if (nextStatus.sarvam === "error" && typeof health.sarvam_configured === "boolean") {
        nextStatus.sarvam = health.sarvam_configured ? "available" : "unavailable";
      }
    }

    setEngineStatus(nextStatus);
  }, []);

  const loadMeetings = useCallback(async () => {
    if (!canUseWorkspace) {
      setMeetings([]);
      return;
    }

    try {
      const res = await listMeetings();
      setMeetings(res.data);
    } catch (err) {
      console.error("Failed to load meetings:", err);
    }
  }, [canUseWorkspace]);

  const loadMeetingData = useCallback(async (meetingId) => {
    if (!canUseWorkspace) {
      return;
    }

    try {
      const [meetingRes, transcriptRes, summaryRes, chatRes] = await Promise.allSettled([
        getMeeting(meetingId),
        getTranscript(meetingId),
        getSummary(meetingId),
        getChatHistory(meetingId),
      ]);

      if (meetingRes.status === "fulfilled") {
        setActiveMeeting(meetingRes.value.data);
      }
      if (transcriptRes.status === "fulfilled") {
        setSegments(transcriptRes.value.data.segments || []);
      }
      if (summaryRes.status === "fulfilled") {
        setSummary(summaryRes.value.data);
      }
      if (chatRes.status === "fulfilled") {
        setChatMessages(chatRes.value.data.messages || []);
      }
    } catch (err) {
      console.error("Failed to load meeting data:", err);
    }
  }, [canUseWorkspace]);

  const refreshOnboardingState = useCallback(async (assumeAuthenticated = false) => {
    if (!isHostedMode) {
      setOnboardingStatus("complete");
      setOnboardingError("");
      setOnboardingNotice("");
      return { needs_onboarding: false };
    }

    if (!assumeAuthenticated && authStatus !== "authenticated") {
      setOnboardingStatus("idle");
      setOnboardingError("");
      setOnboardingNotice("");
      return { needs_onboarding: false };
    }

    setOnboardingStatus("loading");
    setOnboardingError("");

    try {
      const res = await getOnboardingState();
      const state = res.data || {};

      if (state.needs_onboarding) {
        setOnboardingStatus("required");
        setOnboardingNotice("");
        return state;
      }

      setOnboardingStatus("complete");
      setOnboardingNotice("");
      return state;
    } catch (err) {
      setOnboardingStatus("error");
      setOnboardingError(describeRequestError(err, "Failed to load organization onboarding state"));
      setOnboardingNotice("");
      return { needs_onboarding: false, error: true };
    }
  }, [authStatus, isHostedMode]);

  const handleChunkReady = useCallback(
    async (blob, chunkIndex, elapsed, chunkDurationSeconds) => {
      if (!activeMeetingId || !canUseWorkspace) return;
      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append("audio", blob, `chunk_${chunkIndex}.${extensionForAudioBlob(blob)}`);
        formData.append("chunk_index", chunkIndex.toString());
        formData.append("elapsed_seconds", elapsed.toString());
        formData.append("chunk_duration_seconds", chunkDurationSeconds.toString());

        const res = await transcribeAudio(activeMeetingId, formData);
        await syncSummaryStateAfterTranscriptionChunk(res, {
          mergeSegments: (nextSegments) => setSegments((prev) => mergeSegmentsById(prev, nextSegments)),
          refreshSummaryState: async () => {
            try {
              await refreshMeetingState();
            } catch (refreshError) {
              console.error("Failed to refresh summary-first state:", refreshError);
            }
          },
        });
      } catch (err) {
        console.error("Transcription error:", err);
        toast.error(describeRequestError(err, "Transcription failed for this chunk"));
      } finally {
        setIsTranscribing(false);
      }
    },
    [activeMeetingId, canUseWorkspace, refreshMeetingState]
  );

  const {
    isRecording,
    isPaused,
    elapsedSeconds,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  } = useAudioRecorder({ onChunkReady: handleChunkReady, chunkIntervalMs: 7000 });

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setBootstrapStatus("loading");
      setBootstrapError("");

      try {
        const config = await initializeRuntimeConfig();
        if (cancelled) return;
        setRuntimeConfig(config);

        await loadProviderStatus();
        if (cancelled) return;

        if (config?.auth?.required) {
          const token = getStoredAuthToken();
          if (token) {
            try {
              const meRes = await getCurrentUser();
              if (cancelled) return;
              setCurrentUser(meRes.data);
              setAuthStatus("authenticated");
              await refreshOnboardingState(true);
            } catch (meError) {
              try {
                const onboardingRes = await getOnboardingState();
                if (cancelled) return;
                const onboardingState = onboardingRes.data || {};
                if (!onboardingState.needs_onboarding) {
                  throw meError;
                }
                setCurrentUser(null);
                setAuthStatus("authenticated");
                setOnboardingStatus("required");
                setOnboardingError("");
                setOnboardingNotice("");
              } catch {
                resetLocalSession();
                if (typeof window !== "undefined") {
                  setHostedPostLoginPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
                }
                replaceBrowserPath(HOSTED_AUTH_SIGN_IN_PATH);
                if (cancelled) return;
              }
              if (cancelled) return;
            }
          } else {
            setAuthStatus("anonymous");
            setCurrentUser(null);
            setOnboardingStatus("idle");
            if (typeof window !== "undefined") {
              setHostedPostLoginPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
            }
            replaceBrowserPath(HOSTED_AUTH_SIGN_IN_PATH);
            if (cancelled) return;
          }
        } else {
          setCurrentUser(null);
          setAuthStatus("authenticated");
          setOnboardingStatus("complete");
        }

        if (!cancelled) {
          setBootstrapStatus("ready");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("App bootstrap failed:", err);
        setBootstrapStatus("error");
        setAuthStatus("error");
        setBootstrapError(describeRequestError(err, "Failed to load runtime configuration"));
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [loadProviderStatus, refreshOnboardingState, replaceBrowserPath, resetLocalSession]);

  useEffect(() => {
    if (bootstrapStatus !== "ready") {
      return;
    }

    if (!canUseWorkspace) {
      setMeetings([]);
      setActiveMeeting(null);
      setSegments([]);
      setSummary(null);
      setChatMessages([]);
      return;
    }

    loadMeetings();
  }, [bootstrapStatus, canUseWorkspace, loadMeetings]);

  useEffect(() => {
    if (routeMeetingId) {
      setActiveMeetingId((currentMeetingId) => (currentMeetingId === routeMeetingId ? currentMeetingId : routeMeetingId));
      return;
    }

    if (currentPath === "/meetings" || currentPath === "/meetings/new") {
      setActiveMeetingId(null);
    }
  }, [currentPath, routeMeetingId]);

  useEffect(() => {
    if (!activeMeetingId || !canUseWorkspace) {
      setActiveMeeting(null);
      setSegments([]);
      setSummary(null);
      setChatMessages([]);
      return;
    }

    loadMeetingData(activeMeetingId);
  }, [activeMeetingId, canUseWorkspace, loadMeetingData]);

  const handleSignOut = async () => {
    await performHostedSignOutFlow({
      isHostedMode,
      signOutHostedSession,
      resetLocalSession,
      resetWorkspaceState,
      clearPostLoginPath: clearHostedPostLoginPath,
      replaceBrowserPath,
      logError: console.error,
    });
  };

  const handleOnboardingStateRetry = async () => {
    await retryHostedOnboardingFlow({
      clearOnboardingError: setOnboardingError,
      refreshOnboardingState,
    });
  };

  const handleNewMeeting = async (title, engine = defaultEngine) => {
    if (!canUseWorkspace) {
      toast.error("Sign in to create meetings.");
      return;
    }
    try {
      setIsCreatingMeeting(true);
      const meetingTitle = title || "Meeting " + new Date().toLocaleString();
      const res = await createMeeting(meetingTitle, engine);
      setMeetings((prev) => [res.data, ...prev]);
      setActiveMeetingId(res.data.id);
      setDraftMeetingTitle("");
      setDraftMeetingEngine(defaultEngine);
      setHasChosenDraftMeetingEngine(false);
      pushBrowserPath(`/meetings/${res.data.id}`);
      toast.success(
        `Meeting created with ${engine === "sarvam" ? "Sarvam Saaras v3" : "OpenAI GPT-4o Transcribe"}`
      );
    } catch (err) {
      toast.error(describeRequestError(err, "Failed to create meeting"));
    } finally {
      setIsCreatingMeeting(false);
    }
  };

  const openNewMeetingPage = useCallback(() => {
    setDraftMeetingEngine(defaultEngine);
    setHasChosenDraftMeetingEngine(false);
    pushBrowserPath("/meetings/new");
  }, [defaultEngine, pushBrowserPath]);

  const handleDeleteMeeting = async (id) => {
    try {
      if (isRecording && activeMeetingId === id) {
        stopRecording();
      }
      await deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (activeMeetingId === id) {
        setActiveMeetingId(null);
        replaceBrowserPath("/meetings");
      }
      toast.success("Meeting deleted");
    } catch (err) {
      toast.error(describeRequestError(err, "Failed to delete meeting"));
    }
  };

  const handleSelectMeeting = useCallback(
    (meetingId) => {
      setActiveMeetingId(meetingId);
      pushBrowserPath(`/meetings/${meetingId}`);
    },
    [pushBrowserPath]
  );

  const focusMeetingSearch = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const searchInput = document.getElementById("meeting-search");
    if (searchInput && typeof searchInput.focus === "function") {
      searchInput.focus();
    }
  }, []);

  const handleStartRecording = async () => {
    if (!activeMeetingId || !activeMeeting) return;
    if (!canUseWorkspace) {
      toast.error("Sign in to start recording.");
      return;
    }
    if (engineAvailability?.[activeMeeting.engine]?.available !== true) {
      toast.error(
        `${activeMeeting.engine === "sarvam" ? "Sarvam" : "OpenAI Transcribe"} is not configured right now.`
      );
      return;
    }

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: "microphone" });
        if (permission.state === "denied") {
          toast.error(
            "Microphone permission is denied for this site. Open browser site settings and allow it, then retry."
          );
          return;
        }
      }

      await startRecording();
      await updateMeeting(activeMeetingId, { status: "recording" });
      setActiveMeeting((prev) => (prev ? { ...prev, status: "recording" } : prev));
      loadMeetings();
      toast.success("Recording started");
    } catch (err) {
      toast.error(resolveMicPermissionMessage(err));
    }
  };

  const handlePauseRecording = async () => {
    try {
      const didPause = await pauseRecording();
      if (!didPause) {
        toast.error("Recorder pause was interrupted. Retry if you still want to pause.");
        return;
      }

      await updateMeeting(activeMeetingId, { status: "paused" });
      setActiveMeeting((prev) => (prev ? { ...prev, status: "paused" } : prev));
      loadMeetings();
    } catch (err) {
      toast.error(describeRequestError(err, "Failed to pause recording"));
    }
  };

  const handleResumeRecording = async () => {
    try {
      const didResume = await resumeRecording();
      if (!didResume) {
        toast.error("Recorder resume was interrupted. Retry if you still want to continue.");
        return;
      }

      await updateMeeting(activeMeetingId, { status: "recording" });
      setActiveMeeting((prev) => (prev ? { ...prev, status: "recording" } : prev));
      loadMeetings();
    } catch (err) {
      toast.error(describeRequestError(err, "Failed to resume recording"));
    }
  };

  const handleStopRecording = async () => {
    try {
      const didStop = await stopRecording();
      if (!didStop) {
        toast.error("Recorder stop was interrupted. Retry if the meeting is still active.");
        return;
      }

      await updateMeeting(activeMeetingId, { status: "completed" });
      setActiveMeeting((prev) => (prev ? { ...prev, status: "completed" } : prev));
      loadMeetings();
      toast.success("Recording stopped");
    } catch (err) {
      toast.error(describeRequestError(err, "Failed to stop recording"));
    }
  };

  const handleSearch = async (query) => {
    if (!query || query.length < 2) {
      loadMeetings();
      return;
    }

    try {
      const res = await searchTranscripts(query);
      const matchedMeetingIds = new Set(res.data.results.map((r) => r.meeting.id));
      setMeetings((prev) => {
        const allMeetings = [...prev];
        return allMeetings.sort((a, b) => {
          const aMatch = matchedMeetingIds.has(a.id) ? 0 : 1;
          const bMatch = matchedMeetingIds.has(b.id) ? 0 : 1;
          return aMatch - bMatch;
        });
      });
    } catch (err) {
      console.error("Search failed:", err);
    }
  };

  const handleCreateOrganization = async (event) => {
    event.preventDefault();
    if (!organizationName.trim()) {
      setOnboardingError("Organization name is required.");
      return;
    }

    setIsOnboardingSubmitting(true);
    setOnboardingError("");
    setOnboardingNotice("");

    try {
      const res = await createOrganization(organizationName.trim(), organizationSlug.trim() || undefined);
      const nextOrg = res.data?.organization || null;
      if (res.data?.access_token) {
        setAuthToken(res.data.access_token);
      }
      if (res.data?.user) {
        setCurrentUser(res.data.user);
      }
      setOnboardingStatus("complete");
      setOnboardingNotice(`Organization ${nextOrg?.name || "created"} is ready.`);
      await loadMeetings();
      toast.success("Organization created");
    } catch (err) {
      setOnboardingError(describeRequestError(err, "Failed to create organization"));
    } finally {
      setIsOnboardingSubmitting(false);
    }
  };

  const handleAcceptInvite = async (event) => {
    event.preventDefault();
    if (!inviteToken.trim()) {
      setOnboardingError("Invite token is required.");
      return;
    }

    setIsOnboardingSubmitting(true);
    setOnboardingError("");
    setOnboardingNotice("");

    try {
      const res = await acceptOrganizationInvite(inviteToken.trim());
      const nextOrg = res.data?.organization || null;
      if (res.data?.access_token) {
        setAuthToken(res.data.access_token);
      }
      if (res.data?.user) {
        setCurrentUser(res.data.user);
      }
      setOnboardingStatus("complete");
      setOnboardingNotice(`Joined ${nextOrg?.name || "organization"}.`);
      await loadMeetings();
      toast.success("Invite accepted");
    } catch (err) {
      setOnboardingError(describeRequestError(err, "Failed to accept invite"));
    } finally {
      setIsOnboardingSubmitting(false);
    }
  };

  const renderHostedOnboardingPanel = () => (
    <div className="flex flex-1 items-center justify-center bg-[#FBFBFC] px-6 py-10">
      <div className="w-full max-w-2xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <div className="mb-6">
          <p className="overline-label mb-3">ORGANIZATION SETUP</p>
          <h2
            className="text-2xl font-semibold tracking-tight text-[#0A0A0A]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Choose your organization
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">
            Create a new workspace or join an existing one with an invite token. The app updates your active
            organization as soon as onboarding completes.
          </p>
        </div>

        {onboardingNotice && (
          <div className="mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span>{onboardingNotice}</span>
          </div>
        )}

        {onboardingError && (
          <div className="mb-4 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="flex items-center justify-between gap-3">
              <span>{onboardingError}</span>
              {onboardingStatus === "error" && (
                <button
                  type="button"
                  onClick={handleOnboardingStateRetry}
                  disabled={isOnboardingSubmitting}
                  className="shrink-0 border border-amber-300 px-3 py-1 text-xs font-medium text-amber-900 disabled:opacity-60"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {onboardingStatus !== "error" && (
          <>
            <div className="mb-6 flex border border-[#E5E7EB]">
              <button
                type="button"
                onClick={() => setOnboardingMode("create")}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  onboardingMode === "create" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
                }`}
              >
                Create organization
              </button>
              <button
                type="button"
                onClick={() => setOnboardingMode("invite")}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  onboardingMode === "invite" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
                }`}
              >
                Join with invite
              </button>
            </div>

            <form className="space-y-4" onSubmit={onboardingMode === "create" ? handleCreateOrganization : handleAcceptInvite}>
              {onboardingMode === "create" ? (
                <>
                  <div>
                    <label
                      htmlFor="org-name"
                      className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]"
                    >
                      Organization name
                    </label>
                    <input
                      id="org-name"
                      type="text"
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                      className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                      placeholder="Acme Team"
                      autoComplete="organization"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="org-slug"
                      className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]"
                    >
                      Organization slug
                    </label>
                    <input
                      id="org-slug"
                      type="text"
                      value={organizationSlug}
                      onChange={(event) => setOrganizationSlug(event.target.value)}
                      className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                      placeholder="acme-team"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label
                    htmlFor="invite-token"
                    className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]"
                  >
                    Invite token
                  </label>
                  <input
                    id="invite-token"
                    type="text"
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                    placeholder="Paste invite token"
                    autoComplete="one-time-code"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isOnboardingSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#002FA7] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
              >
                {isOnboardingSubmitting ? "Working" : onboardingMode === "create" ? "Create organization" : "Join organization"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );

  if (bootstrapStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-xl border border-amber-200 bg-amber-50 px-6 py-5 text-amber-900">
          <p className="text-sm font-medium">App bootstrap failed</p>
          <p className="mt-2 text-sm leading-6">{bootstrapError}</p>
        </div>
      </div>
    );
  }

  if (bootstrapStatus === "ready" && hostedWorkspaceStage === "app") {
    const navItems = [
      { href: "/app", label: "Dashboard" },
      { href: "/meetings", label: "Meetings" },
    ];
    const hasMeetingHistory = meetings.length > 0;
    const showCreatePage = currentPath === "/meetings/new" && !activeMeeting;
    const showMeetingHistory = !activeMeeting && hasMeetingHistory && !showCreatePage;
    const showEmptyMeetingEntry = !activeMeeting && !hasMeetingHistory && !showCreatePage;
    const activePath = currentPath.startsWith("/meetings") ? "/meetings" : "/app";
    const pageTitle = activeMeeting?.title || (showCreatePage ? "New meeting" : "Meetings");
    const pageDescription = activeMeeting
      ? "Focused workspace"
      : showCreatePage
        ? "Start a meeting"
      : hasMeetingHistory
        ? "Meeting history"
        : "Start a meeting";

    return (
      <AppShell
        workspaceName="Meeting Agent"
        pageTitle={pageTitle}
        pageDescription={pageDescription}
        userEmail={currentUser?.email || ""}
        deploymentMode={runtimeConfig?.deployment_mode || ""}
        activePath={activePath}
        navItems={navItems}
        onCreateMeeting={openNewMeetingPage}
        onSearch={showMeetingHistory ? focusMeetingSearch : undefined}
        onSignOut={isHostedMode && currentUser ? handleSignOut : undefined}
      >
        {activeMeeting && !activeEngineAvailable && (
          <div className="mb-4 border border-amber-200 bg-amber-50 px-6 py-3 text-amber-900">
            <p className="text-sm">
              {activeMeeting.engine === "sarvam" ? "Sarvam" : "OpenAI GPT-4o Transcribe"} is not configured right now.
              The rest of the app still works, but recording for this meeting will fail until the provider is available.
            </p>
          </div>
        )}

        <div className={`flex min-h-0 flex-1 overflow-hidden ${showEmptyMeetingEntry || showCreatePage ? "bg-transparent" : "rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.96),rgba(18,15,24,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.24)]"} ${showMeetingHistory ? "flex-col xl:flex-row" : "flex-col"}`}>
          {showMeetingHistory ? (
            <div className="flex min-h-0 w-full flex-col border-b border-white/8 bg-[linear-gradient(180deg,rgba(31,24,37,0.92),rgba(20,16,27,0.98))] xl:w-[340px] xl:min-w-[340px] xl:border-b-0 xl:border-r">
              <MeetingHistory
                meetings={meetings}
                activeMeetingId={activeMeetingId}
                onSelectMeeting={handleSelectMeeting}
                onNewMeeting={openNewMeetingPage}
                onDeleteMeeting={handleDeleteMeeting}
                onSearch={handleSearch}
              />
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
            {showCreatePage ? (
              <MeetingCreateScreen
                title={draftMeetingTitle}
                engine={draftMeetingEngine}
                defaultEngine={defaultEngine}
                engineAvailability={engineAvailability}
                onTitleChange={setDraftMeetingTitle}
                onEngineChange={handleDraftMeetingEngineChange}
                onCreateMeeting={() => handleNewMeeting(draftMeetingTitle, draftMeetingEngine || defaultEngine)}
                onOpenHistory={() => replaceBrowserPath("/meetings")}
                isSubmitting={isCreatingMeeting}
              />
            ) : (
              <SummaryFirstMeetingScreen
                meeting={activeMeeting}
                hasMeetingHistory={hasMeetingHistory}
                onCreateMeeting={openNewMeetingPage}
                summaryState={{
                  ...summaryState,
                  chatMessages,
                }}
                buddyResponse={buddyAgent.response}
                buddyLoading={buddyAgent.loading}
                buddyError={buddyAgent.error}
                onAskBuddy={(message) => buddyAgent.askBuddy(message, summaryState)}
                onSendChatMessage={async (content) => {
                  if (!activeMeeting?.id) {
                    return;
                  }
                  setChatMessages((prev) => [...prev, { role: "user", content }]);
                  try {
                    const { data } = await sendChatMessage(activeMeeting.id, content);
                    setChatMessages((prev) => [...prev, data]);
                  } catch {
                    // Best-effort chat send; failures are non-fatal for the summary-first surface.
                  }
                }}
                onStartRecording={handleStartRecording}
                onPauseRecording={handlePauseRecording}
                onResumeRecording={handleResumeRecording}
                onStopRecording={handleStopRecording}
                isRecording={isRecording}
                isPaused={isPaused}
                elapsedSeconds={elapsedSeconds}
              />
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#FBFBFC]" data-testid="app-root">
      <Toaster position="top-right" richColors />
      {bootstrapStatus === "loading" && (
        <div className="flex flex-1 items-center justify-center text-sm text-[#6B7280]">
          Loading runtime configuration...
        </div>
      )}

      {bootstrapStatus === "ready" && hostedWorkspaceStage === "auth" && (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-[#6B7280]">
          Redirecting to secure sign-in...
        </div>
      )}

      {bootstrapStatus === "ready" && hostedWorkspaceStage === "loading" && isHostedMode && authStatus === "authenticated" && (
        <div className="flex flex-1 items-center justify-center text-sm text-[#6B7280]">
          Checking organization access...
        </div>
      )}

      {bootstrapStatus === "ready" && hostedWorkspaceStage === "onboarding" && renderHostedOnboardingPanel()}
    </div>
  );
}

export default App;
