from aiohttp import web
import socketio
import random
from socketio.exceptions import ConnectionRefusedError

sio = socketio.AsyncServer()
app = web.Application()
sio.attach(app)

def randHex(n):
    return '%030x' % random.randrange(16**n)

async def index(request):
    """Serve the client-side application."""
    with open('index.html') as f:
        return web.Response(text=f.read(), content_type='text/html')

players = dict()


@sio.event
def connect(sid, environ, auth):
    print("connect ", sid)
    if auth.get("code") != "123" or not auth or not auth.get("code") or not auth.get("name"):
        # Reject the connection
        raise ConnectionRefusedError('Join request rejected')

    players[sid] = {
        "name": auth.get("name"),
        "discriminator": randHex(6),
        "points": 0
    }

    return

@sio.event
def disconnect(sid):
    print('disconnect ', sid)
    players.pop(sid, None)


app.router.add_static('/static', 'static')
app.router.add_get('/', index)

if __name__ == '__main__':
    web.run_app(app, port=6600)
