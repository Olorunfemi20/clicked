"use client";

import React, { useState, useEffect } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "../../lib/auth";
import { initSocket, closeSocket } from "../../lib/socket";
import MessageInput from "../../components/chat/MessageInput";
import TransferCard from "../../components/chat/TransferCard";

type TextMsg = { id: string; type: "text"; content: string; sender: { username: string } };
type TransferMsg = {
  id: string;
  type: "transfer";
  amount: number;
  token?: string;
  txHash: string;
  sender: { username: string };
};
type Msg = TextMsg | TransferMsg;

export default function ChatPage() {
  const { token, isLoading: authLoading } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [conversationId, setConversationId] = useState<string>("test-convo-1");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize socket and join room
  useEffect(() => {
    if (!token || authLoading) return;

    try {
      const s = initSocket(token);
      setSocket(s);

      // Listen for new messages
      s.on("new_message", (msg: any) => {
        const parsedMsg = parseMessage(msg);
        if (parsedMsg) {
          setMessages((prev) => [...prev, parsedMsg]);
        }
      });

      // Listen for room joined
      s.on("room_joined", ({ conversationId: cid }: any) => {
        console.log("Joined room:", cid);
        // Load message history
        s.emit("message_history", { conversationId: cid });
      });

      // Listen for message history
      s.on("message_history", (data: any) => {
        const history = data.messages || [];
        const parsed = history
          .map((msg) => parseMessage(msg))
          .filter((m) => m !== null) as Msg[];
        setMessages(parsed.reverse());
        setLoading(false);
      });

      // Listen for errors
      s.on("error", (err: any) => {
        console.error("Socket error:", err);
        setError(String(err?.message || err));
      });

      // Join the default conversation
      s.emit("join_room", { conversationId });

      return () => {
        closeSocket();
      };
    } catch (err: any) {
      setError(String(err?.message || err));
      setLoading(false);
    }
  }, [token, authLoading, conversationId]);

  function parseMessage(msg: any): Msg | null {
    if (!msg) return null;

    const content = msg.content || "";
    const sender = msg.sender || { username: "unknown" };

    // Try to parse as JSON for transfer messages
    try {
      const parsed = JSON.parse(content);
      if (parsed.type === "transfer" && parsed.txHash) {
        return {
          id: msg.id,
          type: "transfer",
          amount: parsed.amount,
          token: parsed.token,
          txHash: parsed.txHash,
          sender,
        };
      }
    } catch {
      // Not JSON, treat as plain text
    }

    return {
      id: msg.id,
      type: "text",
      content,
      sender,
    };
  }

  const recipient = "GDESTRECIPIENTEXAMPLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="max-w-2xl mx-auto h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 mb-4">No authentication token found</div>
          <p className="text-sm text-gray-500">
            Please log in first, or set NEXT_PUBLIC_AUTH_TOKEN in .env.local
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto h-screen flex items-center justify-center">
        <div className="text-gray-600">Connecting to chat...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto h-screen flex flex-col bg-white">
      <header className="p-4 border-b flex justify-between items-center">
        <h1 className="font-bold">Chat</h1>
        <span className="text-sm text-gray-500">
          {socket?.connected ? "Connected ✓" : "Disconnected"}
        </span>
      </header>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 text-sm">{error}</div>
      )}

      <main className="flex-1 overflow-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No messages yet. Start a conversation!</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-2">
              <div className="text-xs text-gray-500 w-24">{m.sender.username}</div>
              <div className="flex-1">
                {m.type === "text" ? (
                  <div className="p-2 bg-gray-100 rounded inline-block">{m.content}</div>
                ) : (
                  <TransferCard amount={m.amount} token={m.token} txHash={m.txHash} />
                )}
              </div>
            </div>
          ))
        )}
      </main>

      <MessageInput
        conversationId={conversationId}
        recipient={recipient}
        socket={socket}
      />
    </div>
  );
}
