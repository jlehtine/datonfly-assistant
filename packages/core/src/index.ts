// Types
export type {
    UserIdentity,
    User,
    Thread,
    ThreadMember,
    ThreadMemberInfo,
    ThreadMemberRole,
    ThreadMessage,
    MessageRole,
    ContentPart,
    TextContentPart,
    ToolCallContentPart,
    ToolResultContentPart,
    SearchResult,
    MemoryEntry,
} from "./types/index.js";

export { INTERRUPTION_MARKER } from "./types/index.js";

// Interfaces
export type {
    IAgentProvider,
    AgentMessage,
    AgentMessageRole,
    AgentStreamChunk,
    ShouldRespondResult,
    IPersistenceProvider,
    CreateThreadOptions,
    ListThreadsOptions,
    AppendMessageOptions,
    LoadMessagesOptions,
    ISearchProvider,
    SearchDocument,
    IndexDocumentOptions,
    SemanticSearchOptions,
    IEmbeddingsProvider,
    ITool,
    IMemoryProvider,
    SaveMemoryOptions,
    SearchMemoryOptions,
    ListMemoryOptions,
} from "./interfaces/index.js";

// Events
export type {
    SendMessageEvent,
    JoinThreadEvent,
    LeaveThreadEvent,
    TypingStartEvent,
    TypingStopEvent,
    InviteMemberEvent,
    RemoveMemberEvent,
    UpdateMemberRoleEvent,
    ClientToServerEvent,
    MessageDeltaEvent,
    MessageCompleteEvent,
    NewMessageEvent,
    TypingEvent,
    PresenceUpdateEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    MemberRoleChangedEvent,
    ThreadUpdatedEvent,
    ThreadCreatedEvent,
    ErrorEvent,
    WelcomeEvent,
    ServerToClientEvent,
} from "./events/index.js";

// DTOs (schemas are values, not just types)
export {
    textContentPartSchema,
    toolCallContentPartSchema,
    toolResultContentPartSchema,
    contentPartSchema,
    createThreadRequestSchema,
    updateThreadRequestSchema,
    chatRequestSchema,
    inviteMemberRequestSchema,
    removeMemberRequestSchema,
    updateMemberRoleRequestSchema,
    searchRequestSchema,
    memorySearchRequestSchema,
    paginationQuerySchema,
    userSearchQuerySchema,
    userSearchResultWireSchema,
    userSearchResultListWireSchema,
} from "./dto/index.js";

export type {
    CreateThreadRequest,
    UpdateThreadRequest,
    ChatRequest,
    InviteMemberRequest,
    RemoveMemberRequest,
    UpdateMemberRoleRequest,
    SearchRequest,
    MemorySearchRequest,
    PaginationQuery,
    UserSearchQuery,
    UserSearchResultWire,
} from "./dto/index.js";

// Endpoints
export {
    API_PREFIX,
    WS_PATH,
    THREADS_PATH,
    USERS_SEARCH_PATH,
    threadPath,
    threadMessagesPath,
    threadMembersPath,
    threadWireSchema,
    threadListWireSchema,
    threadMessageWireSchema,
    threadMessageListWireSchema,
    threadMemberInfoWireSchema,
    threadMemberInfoListWireSchema,
} from "./endpoints/index.js";

export type { ThreadWire, ThreadMessageWire, ThreadMemberInfoWire } from "./endpoints/index.js";
