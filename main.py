from aiohttp import web  # pyright: ignore[reportMissingImports]
import socketio  # pyright: ignore[reportMissingImports]
import random
import logging
import time
import os
from socketio.exceptions import ConnectionRefusedError  # pyright: ignore[reportMissingImports]
from typing import Dict

# TODO: Implement timer

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(cors_allowed_origins=[
    'https://buzzer.groups.id', # NOTE: Add your own domain here
    'https://www.buzzer.groups.id', # ugh safari
    'http://localhost:6600'
])
app = web.Application()
sio.attach(app)

CODE_LENGTH = 4
MAX_NAME_LENGTH = 25
MAX_ANSWER_LENGTH = 10

def rand_hex() -> str:
    return ('%06x' % random.randrange(16 ** 6)).upper()
def rand_code() -> str:
    global CODE_LENGTH
    if len(rooms) >= 2*10**(CODE_LENGTH-1):
        CODE_LENGTH += 1
    while (result := str(random.randint(10**(CODE_LENGTH-1), 10**CODE_LENGTH - 1))) in rooms:
        continue
    return result

class Player:
    def __init__(self, sid: str, name: str, room: 'Room'):
        self.sid = sid
        self.name = name
        self.room = room
        self.points = 0
        self.buzzed = False
        self.buzztime = -1
        self.answer = ''

    def rename(self, new_name: str):
        self.name = new_name

    def increment(self):
        self.points += 1
    def decrement(self):
        self.points -= 1

    def buzz(self, answer: str):
        self.buzzed = True
        self.buzztime = time.time()
        self.answer = answer
    def unbuzz(self):
        self.buzzed = False
        self.buzztime = -1
        self.answer = ''

class Admin:
    def __init__(self, sid: str, room: 'Room'):
        self.sid = sid
        self.room = room

class Room:
    def __init__(self, code: str):
        self.code = code
        self.admin = None
        self.players = []
        self.locked = True

    def assign_admin(self, admin: Admin) -> None:
        self.admin = admin

    def generate_leaderboard(self) -> Dict:
        return {'code': self.code, 'players': sorted([{'sid': p.sid, 'name': p.name, 'points': p.points} for p in self.players], key=lambda x: x['points'], reverse=True)}

    def lock(self):
        self.locked = True
    def unlock(self):
        self.locked = False

players: Dict[str, Player] = dict() # sid
admins: Dict[str, Admin] = dict() # sid
rooms: Dict[str, Room] = dict() # code


async def update_leaderboard(room: Room):
    await sio.emit('leaderboard', room.generate_leaderboard(), to=room.code)

async def update_player_buzzstate(player: Player):
    await sio.emit('buzzstate', {
        'buzzed': player.buzzed,
        'locked': player.room.locked,
        # buzzed?
        # locked?
    }, to=player.sid)

async def update_admin_buzzstate(admin: Admin):
    await sio.emit('adminbuzzstate', {
        'locked': admin.room.locked,
        'players': [{'sid': x.sid, 'name': x.name, 'answer': x.answer} for x in sorted(admin.room.players, key=lambda x: (time.time()-x.buzztime, x.points), reverse=True) if x.buzzed]
    }, to=admin.sid)

# region Socket Lifecycle

@sio.event
async def connect(sid, environ, auth):
    if not auth:
        raise ConnectionRefusedError('No authentication data!')
    if auth.get('role') == 'admin':
        code = rand_code()
        rooms[code] = room = Room(code)
        admins[sid] = Admin(sid, room)
        room.assign_admin(admins[sid])
        await update_admin_buzzstate(admins[sid])
        logger.info(f'[{code}][{sid}] Started the game')
    elif auth.get('role') == 'player':
        if not (room := rooms.get(auth.get('code'))):
            raise ConnectionRefusedError('No such room exists!')
        if not auth.get('name'):
            raise ConnectionRefusedError('Missing name!')
        if len(auth.get('name')) > MAX_NAME_LENGTH:
            raise ConnectionRefusedError('Name too long (max 50 chars)!')
        players[sid] = Player(sid, auth.get('name'), room)
        room.players.append(players[sid])
        await update_player_buzzstate(players[sid])
        logger.info(f'[{room.code}][{sid}] Joined')
    else:
        raise ConnectionRefusedError('Invalid role!')

    await sio.enter_room(sid, room.code)
    await update_leaderboard(room)

@sio.event
async def disconnect(sid, reason):
    if sid in admins:
        logger.info(f'[{admins[sid].room.code}][{sid}] Disconnected due to: {reason}')
        for player in admins[sid].room.players:
            await sio.disconnect(player.sid)
        rooms.pop(admins[sid].room.code)
        admins.pop(sid)
        logger.info(f'[{admins[sid].room.code}][{sid}] Ended the game')
    if sid in players:
        logger.info(f'[{players[sid].room.code}][{sid}] Disconnected due to: {reason}')
        players[sid].room.players.remove(players[sid])
        await update_leaderboard(players[sid].room)
        await update_admin_buzzstate(players[sid].room.admin)
        players.pop(sid)

# endregion Socket Lifecycle


# region Client Signals

# Player Controls

@sio.on('buzz')
async def buzz(sid, answer):
    if sid in players and not players[sid].buzzed:
        if len(answer) <= MAX_ANSWER_LENGTH:
            logger.info(f'[{players[sid].room.code}][{sid}] Submitted an answer')
            players[sid].buzz(answer)
        else:
            logger.warning(f'[{players[sid].room.code}][{sid}] Sent an answer that was too long')
        await update_player_buzzstate(players[sid]) # Prevent client desync
        await update_admin_buzzstate(players[sid].room.admin)

# Admin Controls

@sio.on('lock')
async def lock(sid):
    if sid in admins:
        admins[sid].room.lock()
        logger.info(f'[{admins[sid].room.code}][{sid}] Locked all buzzers')
        for player in admins[sid].room.players:
            await update_player_buzzstate(player)
        await update_admin_buzzstate(admins[sid])

@sio.on('unlock')
async def unlock(sid):
    if sid in admins:
        admins[sid].room.unlock()
        logger.info(f'[{admins[sid].room.code}][{sid}] Unlocked all buzzers')
        for player in admins[sid].room.players:
            await update_player_buzzstate(player)
        await update_admin_buzzstate(admins[sid])

@sio.on('resetall')
async def resetall(sid):
    if sid in admins:
        logger.info(f'[{admins[sid].room.code}][{sid}] Reset all buzzers')
        for player in admins[sid].room.players:
            player.unbuzz()
            await update_player_buzzstate(player)
        await update_admin_buzzstate(admins[sid])

@sio.on('kick')
async def kick(sid, target):
    if sid in admins and players.get(target) in admins[sid].room.players:
        logger.info(f'[{admins[sid].room.code}][{sid}] Kicked player [{target}]')
        await sio.disconnect(target)
        await update_leaderboard(admins[sid].room)

@sio.on('reset')
async def reset(sid, target):
    if sid in admins and players.get(target) in admins[sid].room.players:
        logger.info(f'[{admins[sid].room.code}][{sid}] Reset [{target}]\'s buzzer')
        players[target].unbuzz()
        await update_player_buzzstate(players[target])
        await update_admin_buzzstate(admins[sid])

@sio.on('rename')
async def rename(sid, target, new_name):
    if sid in admins and players.get(target) in admins[sid].room.players:
        if len(new_name) <= MAX_NAME_LENGTH:
            logger.info(f'[{admins[sid].room.code}][{sid}] Renamed [{target}]')
            players[target].rename(new_name)
        else:
            logger.warning(f'[{admins[sid].room.code}][{sid}] Tried to rename [{target}] to a name that was too long')
        await update_leaderboard(admins[sid].room)
        await update_admin_buzzstate(admins[sid])

@sio.on('plus')
async def plus(sid, target):
    if sid in admins and players.get(target) in admins[sid].room.players:
        logger.info(f'[{admins[sid].room.code}][{sid}] Updated [{target}]\'s score')
        players[target].increment()
        await update_leaderboard(admins[sid].room)

@sio.on('minus')
async def minus(sid, target):
    if sid in admins and players.get(target) in admins[sid].room.players:
        logger.info(f'[{admins[sid].room.code}][{sid}] Updated [{target}]\'s score')
        players[target].decrement()
        await update_leaderboard(admins[sid].room)

# endregion Client Signals

async def index(request):
    with open('public/index.html') as f:
        return web.Response(text=f.read(), content_type='text/html')

app.router.add_get('/', index)
app.router.add_static('/', 'public')
app.router.add_static('/static', 'static')
app.router.add_static('/dist', 'dist')

if __name__ == '__main__':
    if os.environ.get('VERBOSE'): logging.basicConfig(level=logging.INFO)
    web.run_app(app, port=int(os.environ.get('PORT', 6600)))
