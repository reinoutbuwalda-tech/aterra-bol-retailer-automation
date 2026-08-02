import { getActor } from "@/lib/auth";
import { getControlRoomState } from "@/db/runtime";
import ControlRoom from "./control-room";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor();
  const state = await getControlRoomState();
  return <ControlRoom actor={actor} initialState={state} />;
}
