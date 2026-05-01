import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import {
  councilChannels,
  councilChannelMessages,
  councilChannelPersonas,
  councilPersonas,
} from "@/server/db/schema/council";
import { and, asc, eq } from "drizzle-orm";
import { CouncilRoom } from "./council-room";
import type { ClientMessage } from "./use-council-stream";

export default async function CouncilChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { channelId } = await params;

  const [channel] = await db
    .select()
    .from(councilChannels)
    .where(
      and(
        eq(councilChannels.id, channelId),
        eq(councilChannels.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!channel) notFound();

  const personaRows = await db
    .select({ persona: councilPersonas })
    .from(councilChannelPersonas)
    .innerJoin(
      councilPersonas,
      eq(councilChannelPersonas.personaId, councilPersonas.id),
    )
    .where(eq(councilChannelPersonas.channelId, channelId));

  const messages = await db
    .select()
    .from(councilChannelMessages)
    .where(eq(councilChannelMessages.channelId, channelId))
    .orderBy(asc(councilChannelMessages.createdAt))
    .limit(200);

  const initial: ClientMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role as ClientMessage["role"],
    content: m.content,
    status: m.status as ClientMessage["status"],
    personaId: m.personaId ?? undefined,
    turnId: m.turnId ?? undefined,
  }));

  return (
    <CouncilRoom
      channelId={channel.id}
      channelName={channel.name}
      channelTopic={channel.topic}
      personas={personaRows.map((r) => r.persona)}
      initialMessages={initial}
    />
  );
}
