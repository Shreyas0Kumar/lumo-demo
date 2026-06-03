"""
End-to-end test: connects to OUR FastAPI proxy on localhost:8000,
which in turn opens a real OpenAI Realtime session. Sends a text turn
and confirms audio + transcript events come back through the proxy.

Run with: python scripts/test_proxy_e2e.py
(Backend must already be running on :8000.)
"""
import asyncio
import json

import websockets

PROXY_URL = "ws://localhost:8000/session/ws?age_band=7-9"


async def main():
    print(f"Connecting to proxy at {PROXY_URL}")
    async with websockets.connect(PROXY_URL) as ws:
        print("Connected to proxy.")

        saw = set()
        audio_deltas = 0
        transcript_parts: list[str] = []
        done_payload = None

        # First message from our proxy is session.created stub
        try:
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            print(f"  <- proxy initial: {first}")
        except Exception as e:
            print(f"!! no initial message: {e}")
            return

        # Send a text turn through the proxy (forwarded verbatim to OpenAI).
        await ws.send(
            json.dumps(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "Hi Lumo! Say hi back briefly."}],
                    },
                }
            )
        )
        await ws.send(json.dumps({"type": "response.create"}))
        print("Sent text item + response.create through proxy.")

        for _ in range(400):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
            except asyncio.TimeoutError:
                print("!! timeout")
                break
            msg = json.loads(raw)
            t = msg.get("type", "?")
            saw.add(t)
            if t == "response.output_audio.delta":
                audio_deltas += 1
            elif t == "response.output_audio_transcript.delta":
                transcript_parts.append(msg.get("delta", ""))
            elif t == "response.done":
                done_payload = msg
                break
            elif t == "error":
                print(f"!! error event: {msg}")
                break

        print(f"\n--- relay summary ---")
        print(f"distinct event types seen: {sorted(saw)}")
        print(f"audio deltas: {audio_deltas}")
        print(f"streamed transcript: {''.join(transcript_parts)!r}")
        if done_payload:
            output = done_payload.get("response", {}).get("output", [])
            print("response.done.output:")
            print(json.dumps(output, indent=2)[:2000])


asyncio.run(main())
