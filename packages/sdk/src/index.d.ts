export interface MeetingApiTransport {
  delete(path: string, options?: unknown): Promise<unknown>;
  get(path: string, options?: unknown): Promise<unknown>;
  post(path: string, body?: unknown, options?: unknown): Promise<unknown>;
  put(path: string, body?: unknown, options?: unknown): Promise<unknown>;
}

export interface MeetingApiClient {
  acceptOrganizationInvite(inviteToken: string): Promise<unknown>;
  createMeeting(title: string, engine?: string): Promise<unknown>;
  createOrganization(name: string, slug?: string): Promise<unknown>;
  deleteMeeting(id: string): Promise<unknown>;
  exchangeHostedSession(providerToken: string, provider?: string): Promise<unknown>;
  exportTranscript(meetingId: string, format?: string): Promise<unknown>;
  generateSummary(meetingId: string): Promise<unknown>;
  getChatHistory(meetingId: string): Promise<unknown>;
  getCurrentUser(): Promise<unknown>;
  getHealth(): Promise<unknown>;
  getMeeting(id: string): Promise<unknown>;
  getOnboardingState(): Promise<unknown>;
  getSummary(meetingId: string): Promise<unknown>;
  getTranscript(meetingId: string): Promise<unknown>;
  listEngines(): Promise<unknown>;
  listLanguages(): Promise<unknown>;
  listMeetings(): Promise<unknown>;
  searchTranscripts(q: string): Promise<unknown>;
  sendChatMessage(meetingId: string, content: string): Promise<unknown>;
  transcribeAudio(meetingId: string, formData: FormData): Promise<unknown>;
  translateMeetingTranscript(meetingId: string, targetLanguage: string): Promise<unknown>;
  translateText(text: string, sourceLang: string, targetLang: string): Promise<unknown>;
  updateMeeting(id: string, data: unknown): Promise<unknown>;
  voiceChat(meetingId: string, formData: FormData): Promise<unknown>;
}

export function createMeetingApiClient(options: {
  transport: MeetingApiTransport;
}): MeetingApiClient;
