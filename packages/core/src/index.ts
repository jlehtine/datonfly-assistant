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
    StatusCode,
    ErrorCode,
} from "./types/index.js";

export { STATUS_CODES, ERROR_CODES } from "./types/index.js";

// Interfaces
export type {
    IAgentProvider,
    AgentMessage,
    AgentMessageRole,
    AgentStreamChunk,
    Citation,
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
    MessageStatusEvent,
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
    updateThreadUserStateRequestSchema,
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
    updateUserRequestSchema,
} from "./dto/index.js";

export type {
    CreateThreadRequest,
    UpdateThreadRequest,
    UpdateThreadUserStateRequest,
    ChatRequest,
    InviteMemberRequest,
    RemoveMemberRequest,
    UpdateMemberRoleRequest,
    SearchRequest,
    MemorySearchRequest,
    PaginationQuery,
    UserSearchQuery,
    UserSearchResultWire,
    UpdateUserRequest,
} from "./dto/index.js";

// Endpoints
export {
    API_PREFIX,
    WS_PATH,
    THREADS_PATH,
    USERS_SEARCH_PATH,
    USERS_ME_PATH,
    threadPath,
    threadMessagesPath,
    threadMembersPath,
    threadUserStatePath,
    threadWireSchema,
    threadListWireSchema,
    threadMessageWireSchema,
    threadMessageListWireSchema,
    threadMemberInfoWireSchema,
    threadMemberInfoListWireSchema,
    userProfileWireSchema,
} from "./endpoints/index.js";

export type { ThreadWire, ThreadMessageWire, ThreadMemberInfoWire, UserProfileWire } from "./endpoints/index.js";
