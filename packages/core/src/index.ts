// Types
export type {
    UserIdentity,
    User,
    Thread,
    ThreadMember,
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
    ClientToServerEvent,
    MessageDeltaEvent,
    MessageCompleteEvent,
    NewMessageEvent,
    TypingEvent,
    PresenceUpdateEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    ThreadUpdatedEvent,
    ThreadCreatedEvent,
    ErrorEvent,
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
    searchRequestSchema,
    memorySearchRequestSchema,
    paginationQuerySchema,
} from "./dto/index.js";

export type {
    CreateThreadRequest,
    UpdateThreadRequest,
    ChatRequest,
    InviteMemberRequest,
    SearchRequest,
    MemorySearchRequest,
    PaginationQuery,
} from "./dto/index.js";

// Endpoints
export {
    API_PREFIX,
    WS_PATH,
    THREADS_PATH,
    threadPath,
    threadMessagesPath,
    threadWireSchema,
    threadListWireSchema,
    threadMessageWireSchema,
    threadMessageListWireSchema,
} from "./endpoints/index.js";

export type { ThreadWire, ThreadMessageWire } from "./endpoints/index.js";
