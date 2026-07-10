const REQUIRED_TRANSPORT_METHODS = ["get", "post", "put", "delete"];

function assertTransport(transport) {
  const isValid = REQUIRED_TRANSPORT_METHODS.every(
    (method) => typeof transport?.[method] === "function",
  );

  if (!isValid) {
    throw new Error("Meeting API transport requires get, post, put, and delete methods");
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

export function createMeetingApiClient({ transport }) {
  assertTransport(transport);

  return {
    acceptOrganizationInvite(inviteToken) {
      return transport.post("/auth/onboarding/invitations/accept", {
        invite_token: inviteToken,
      });
    },
    createMeeting(title, engine = "whisper") {
      return transport.post("/meetings", { title, engine });
    },
    createOrganization(name, slug) {
      return transport.post("/auth/onboarding/organizations", {
        name,
        ...(slug ? { slug } : {}),
      });
    },
    deleteMeeting(id) {
      return transport.delete(`/meetings/${encodePathSegment(id)}`);
    },
    exchangeHostedSession(providerToken, provider = "neon") {
      return transport.post("/auth/session/exchange", {
        provider_token: providerToken,
        provider,
      });
    },
    exportTranscript(meetingId, format = "txt") {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/export`, {
        params: { format },
      });
    },
    fetchMeetingLink(url) {
      return transport.post("/tools/fetch-meeting-link", { url });
    },
    generateSummary(meetingId) {
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/summary`);
    },
    getActionItems(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/action-items`);
    },
    getChapters(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/chapters`);
    },
    getChatHistory(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/chat`);
    },
    getDecisions(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/decisions`);
    },
    getMeetingStateCurrent(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/state/current`);
    },
    getOpenQuestions(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/open-questions`);
    },
    getRecentLines(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/recent-lines`);
    },
    getCurrentUser() {
      return transport.get("/auth/me");
    },
    getHealth() {
      return transport.get("/health");
    },
    getMeeting(id) {
      return transport.get(`/meetings/${encodePathSegment(id)}`);
    },
    getOnboardingState() {
      return transport.get("/auth/onboarding/state");
    },
    getSummary(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/summary`);
    },
    getTranscript(meetingId) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/transcript`);
    },
    listEngines() {
      return transport.get("/engines");
    },
    listLanguages() {
      return transport.get("/languages");
    },
    listMeetings() {
      return transport.get("/meetings");
    },
    queryBuddy(meetingId, { message, currentContext = "", historyContext = "" } = {}) {
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/buddy/query`, {
        message,
        current_context: currentContext,
        history_context: historyContext,
      });
    },
    searchHistory(meetingId, query) {
      return transport.get(`/meetings/${encodePathSegment(meetingId)}/history/search`, {
        params: { q: query },
      });
    },
    searchTranscripts(q) {
      return transport.get("/meetings/search/transcripts", {
        params: { q },
      });
    },
    searchWeb(query) {
      return transport.post("/tools/search-web", { query });
    },
    searchWorkspace(query) {
      return transport.post("/tools/search-workspace", { query });
    },
    sendChatMessage(meetingId, content) {
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/chat`, {
        content,
      });
    },
    transcribeAudio(meetingId, formData) {
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/transcribe`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 30000,
      });
    },
    translateMeetingTranscript(meetingId, targetLanguage) {
      const formData = new FormData();
      formData.append("target_language", targetLanguage);
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/translate`, formData);
    },
    translateText(text, sourceLang, targetLang) {
      return transport.post("/translate", {
        text,
        source_language: sourceLang,
        target_language: targetLang,
      });
    },
    updateMeeting(id, data) {
      return transport.put(`/meetings/${encodePathSegment(id)}`, data);
    },
    voiceChat(meetingId, formData) {
      return transport.post(`/meetings/${encodePathSegment(meetingId)}/voice-chat`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
      });
    },
  };
}
