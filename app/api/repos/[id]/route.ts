import { NextRequest, NextResponse } from "next/server";
import { removeRepo } from "@/lib/repos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget the repository and delete its local clone (the remote is untouched). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await removeRepo(id);
  return NextResponse.json({ ok: true });
}
