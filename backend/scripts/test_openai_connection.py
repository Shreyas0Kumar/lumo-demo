"""
Run with: cd backend && python scripts/test_openai_connection.py
Tests the raw OpenAI Realtime API v2 connection without any FastAPI layer.
"""
import asyncio
import json
import os

import websockets
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))

KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
URL_BASE = os.environ.get("OPENAI_REALTIME_URL", "wss://api.openai.com/v1/realtime")
URL = f"{URL_BASE}?model={MODEL}"


async def main():
    headers = {"Authorization": f"Bearer {KEY}"}
    print(f"Connecting to {URL}")

    async with websockets.connect(URL, additional_headers=headers) as ws:
        print("Connected. Waiting for session.created...")
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        if msg["type"] != "session.created":
            print(f"!! expected session.created, got: {msg}")
            return
        sess = msg["session"]
        print(f"session.created — id: {sess.get('id')}")
        print(f"  voice: {sess.get('voice')}")
        print(f"  model: {sess.get('model')}")

        update = {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": MODEL,
                "output_modalities": ["audio"],
                "instructions": (
                    "You are Lumo, a friendly voice assistant for children "
                    "aged 7-9. Keep responses very short — 1 or 2 sentences. "
                    "Be warm and curious."
                ),
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "transcription": {"model": "whisper-1"},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 600,
                        },
                    },
                    "output": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "voice": "alloy",
                    },
                },
            },
        }
        await ws.send(json.dumps(update))
        print("Sent session.update. Waiting for session.updated...")

        for _ in range(5):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            print(f"  <- {msg['type']}")
            if msg["type"] == "session.updated":
                print("session.updated confirmed.")
                break
            if msg["type"] == "error":
                print(f"ERROR from OpenAI: {json.dumps(msg, indent=2)}")
                return

        await ws.send(
            json.dumps(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": "Hi Lumo! What is the sky?"}
                        ],
                    },
                }
            )
        )
        await ws.send(json.dumps({"type": "response.create"}))
        print("Sent text message + response.create. Listening for response...")

        audio_deltas = 0
        transcript = ""

        for _ in range(200):
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                t = msg["type"]
                if t == "response.audio.delta":
                    audio_deltas += 1
                    if audio_deltas <= 2 or audio_deltas % 10 == 0:
                        print(f"  <- {t} ({len(msg['delta'])} chars base64) [#{audio_deltas}]")
                elif t == "response.audio_transcript.delta":
                    transcript += msg.get("delta", "")
                    print(f"  <- {t} [{msg.get('delta','')!r}]")
                elif t == "response.done":
                    print(f"\n  <- {t}")
                    print(f"\nAudio deltas received: {audio_deltas}")
                    print(f"Transcript: {transcript}")
                    output = msg.get("response", {}).get("output", [])
                    print("\n=== response.output shape ===")
                    print(json.dumps(output, indent=2)[:4000])
                    break
                elif t == "error":
                    print(f"  <- ERROR: {json.dumps(msg, indent=2)}")
                    break
                else:
                    print(f"  <- {t}")
            except asyncio.TimeoutError:
                print("Timeout waiting for response.")
                break


asyncio.run(main())
