import websocket
try:
    ws = websocket.WebSocket()
    ws.connect('ws://localhost:5000/ws/agent')
    print("Connected!")
    ws.send('{"type": "auth", "agent_token": "test"}')
    print('Received:', ws.recv())
except Exception as e:
    print("Error:", e)