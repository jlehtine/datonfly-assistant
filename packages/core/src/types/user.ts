export interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | undefined;
    createdAt: Date;
}
