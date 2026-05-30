"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageInput } from "@/components/chat/MessageInput";
import { NewConversationModal } from "@/components/chat/NewConversationModal";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/components/auth/useAuth";
import { useSocket } from "@/hooks/useSocket";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ConversationMember = {
  user: {
    id: string;
    username: string | null;
  };
};

type Conversation = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  members?: ConversationMember[];
};

type SocketMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
};

type UiMessage = SocketMessage & {
  status: "sent" | "pending" | "failed";
  tempId?: string;
};

type SocketError = {
  event?: string;
  message?: string;
};

function buildTempId() {
  return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function AppPage() {
  const router = useRouter();
  const { token, clearToken } = useAuth();
  const socket = useSocket(token);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [newConversationError, setNewConversationError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isSending = useMemo(
    () => messages.some((message) => message.status === "pending"),
    [messages],
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    fetch(`${API_URL}/conversations`, {
      headers: {
        Authorization: "Bearer " + token,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load conversations");
        }
        const payload = (await response.json()) as Conversation[];
        if (!active) {
          return;
        }
        setConversations(payload);
        setActiveConversationId((current) => current ?? payload[0]?.id ?? null);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setConversations([]);
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!socket || !activeConversationId) {
      return;
    }

    socket.emit("join_room", { conversationId: activeConversationId });
    socket.emit("message_history", { conversationId: activeConversationId });

    const handleHistory = (payload: { conversationId: string; messages: SocketMessage[] }) => {
      if (payload.conversationId !== activeConversationId) {
        return;
      }
      setMessages(payload.messages.map((message) => ({ ...message, status: "sent" })));
    };

    const handleNewMessage = (message: SocketMessage) => {
      if (message.conversationId !== activeConversationId) {
        return;
      }

      setMessages((previous) => {
        const optimisticIndex = previous.findIndex(
          (entry) =>
            entry.status === "pending" &&
            entry.content === message.content,
        );

        if (optimisticIndex >= 0) {
          const next = [...previous];
          next[optimisticIndex] = { ...message, status: "sent" };
          return next;
        }

        return [...previous, { ...message, status: "sent" }];
      });
    };

    const handleError = (error: SocketError) => {
      if (error.event !== "send_message") {
        return;
      }

      setSendError(error.message ?? "Failed to send message");
      setMessages((previous) => {
        let index = -1;
        for (let i = previous.length - 1; i >= 0; i -= 1) {
          if (previous[i]?.status === "pending") {
            index = i;
            break;
          }
        }
        if (index < 0) {
          return previous;
        }

        const next = [...previous];
        const target = next[index];
        if (!target) {
          return previous;
        }
        next[index] = { ...target, status: "failed" };
        return next;
      });
    };

    socket.on("message_history", handleHistory);
    socket.on("new_message", handleNewMessage);
    socket.on("error", handleError);

    return () => {
      socket.off("message_history", handleHistory);
      socket.off("new_message", handleNewMessage);
      socket.off("error", handleError);
    };
  }, [activeConversationId, socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleConversationCreated = (conversation: Conversation) => {
      setConversations((previous) =>
        previous.some((entry) => entry.id === conversation.id)
          ? previous
          : [conversation, ...previous],
      );
      setNewConversationError(null);
      setIsModalOpen(false);
      setIsCreatingConversation(false);
      setActiveConversationId(conversation.id);
    };

    const handleError = (error: SocketError) => {
      if (error.event !== "create_conversation") {
        return;
      }
      setNewConversationError(error.message ?? "Failed to create conversation");
      setIsCreatingConversation(false);
    };

    socket.on("conversation_created", handleConversationCreated);
    socket.on("error", handleError);

    return () => {
      socket.off("conversation_created", handleConversationCreated);
      socket.off("error", handleError);
    };
  }, [socket]);

  const getConversationDisplayName = useCallback((conversation: Conversation) => {
    if (conversation.name) {
      return conversation.name;
    }

    const members = conversation.members?.map((member) => member.user.username ?? member.user.id);
    if (members && members.length > 0) {
      return members.join(", ");
    }

    return "Conversation";
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!socket || !activeConversationId) {
        throw new Error("No active conversation");
      }

      const tempId = buildTempId();
      const optimisticMessage: UiMessage = {
        id: tempId,
        tempId,
        conversationId: activeConversationId,
        senderId: "self",
        content,
        createdAt: new Date().toISOString(),
        status: "pending",
      };

      setSendError(null);
      setMessages((previous) => [...previous, optimisticMessage]);
      socket.emit("send_message", { conversationId: activeConversationId, content });
    },
    [activeConversationId, socket],
  );

  const retryMessage = useCallback(
    async (message: UiMessage) => {
      setMessages((previous) => previous.filter((entry) => entry.id !== message.id));
      await sendMessage(message.content);
    },
    [sendMessage],
  );

  const createConversation = useCallback(
    async (user: { id: string }) => {
      if (!socket) {
        setNewConversationError("Socket connection not ready");
        return;
      }

      setIsCreatingConversation(true);
      setNewConversationError(null);
      socket.emit("create_conversation", { type: "dm", memberIds: [user.id] });
    },
    [socket],
  );

  return (
    <ProtectedRoute mode="authenticated">
      <div className="flex min-h-screen bg-[#F8FAFC] text-[#0F172A]">
        <aside className="w-80 border-r border-[#0F172A]/10 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold">Conversations</h1>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="rounded-full bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white"
            >
              New conversation
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              clearToken();
              router.replace("/");
            }}
            className="mb-4 rounded-full border border-[#0F172A]/20 px-3 py-1.5 text-xs font-medium"
          >
            Sign out
          </button>

          <ul className="space-y-2">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => setActiveConversationId(conversation.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                    conversation.id === activeConversationId
                      ? "border-cyan-300 bg-cyan-50"
                      : "border-[#0F172A]/10 bg-white"
                  }`}
                >
                  {getConversationDisplayName(conversation)}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex flex-1 flex-col">
          <header className="border-b border-[#0F172A]/10 bg-white px-6 py-4">
            <h2 className="text-base font-semibold">
              {activeConversation ? getConversationDisplayName(activeConversation) : "Messages"}
            </h2>
            {sendError ? <p className="mt-1 text-xs text-rose-600">{sendError}</p> : null}
            {newConversationError ? (
              <p className="mt-1 text-xs text-rose-600">{newConversationError}</p>
            ) : null}
          </header>

          <section className="flex-1 space-y-3 overflow-y-auto p-6">
            {messages.map((message) => (
              <article key={message.id} className="max-w-2xl rounded-xl border border-[#0F172A]/10 bg-white px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap">{message.content}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-[#64748B]">
                  <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                  {message.status === "pending" ? <span className="text-amber-600">Pending…</span> : null}
                  {message.status === "failed" ? (
                    <>
                      <span className="text-rose-600">Failed</span>
                      <button
                        type="button"
                        onClick={() => void retryMessage(message)}
                        className="rounded-full border border-rose-300 px-2 py-0.5 text-rose-700"
                      >
                        Retry
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </section>

          <footer className="border-t border-[#0F172A]/10 bg-white p-4">
            <MessageInput
              disabled={!activeConversationId || !socket}
              isSending={isSending}
              onSend={sendMessage}
            />
          </footer>
        </main>
      </div>

      {token ? (
        <NewConversationModal
          open={isModalOpen}
          token={token}
          creating={isCreatingConversation}
          onClose={() => setIsModalOpen(false)}
          onSelectUser={createConversation}
        />
      ) : null}
    </ProtectedRoute>
  );
}
