// @ts-ignore
import { io, Socket } from 'socket.io-client';
import AWN from 'awesome-notifications';

type PlayerData = {
    sid: string,
    name: string,
    points: number
}
type LeaderboardData = {
    code: string,
    players: Array<PlayerData>
}

type PlayerAnswer = {
    sid: string,
    name: string,
    answer: string
}
type Buzzstate = {
    buzzed: boolean,
    locked: boolean
}
type AdminBuzzstate = {
    locked: boolean,
    players: Array<PlayerAnswer>
}

interface ServerToClientEvents {
    //noArg: () => void;
    leaderboard: (data: LeaderboardData) => void;
    buzzstate: (data: Buzzstate) => void;
    adminbuzzstate: (data: AdminBuzzstate) => void;
    //withAck: (d: string, callback: (e: number) => void) => void;
}
interface ClientToServerEvents {
    buzz: (answer: string) => void;
    lock: () => void;
    unlock: () => void;

    kick: (sid: string) => void;
    reset: (sid: string) => void;
    rename: (sid: string, newName: string) => void;
    plus: (sid: string) => void;
    minus: (sid: string) => void;

    resetall: () => void;
    //hello: () => void;
}

/*Method 	Description
tip()       	Show gray toast with any valid HTML you passed in
info()      	Show blue toast with any valid HTML you passed in
warning()   	Show orange toast with any valid HTML you passed in
success() 	  Show green toast with any valid HTML you passed in
alert() 	    Show red toast with any valid HTML you passed in
async() 	    Show async toast, until passed Promise will be completed
modal() 	    Show modal window
confirm()   	Show confirmation window
asyncBlock() 	Show popup which blocks the screen, until passed Promise will be completed
*/
let notifier = new AWN();

const MAX_NAME_LENGTH = 25;
const MAX_ANSWER_LENGTH = 10;

const dialog = document.getElementById('dialog')! as HTMLDialogElement;
const dialogQuestion = document.getElementById('dialog_question')!;
const dialogForm = document.getElementById('dialog_form')! as HTMLFormElement;
const dialogAnswer = document.getElementById('dialog_answer')! as HTMLInputElement;
const dialogCancel = document.getElementById('dialog_cancel')!;
//const dialogConfirm = document.getElementById('dialog_confirm')!;

const connectBox = document.getElementById('connect_box')!;
const connectForm = document.getElementById('connect_form')! as HTMLFormElement;
const code = document.getElementById('code')! as HTMLInputElement;
const name = document.getElementById('name')! as HTMLInputElement;
const roleRadios = document.getElementsByName('role')! as NodeListOf<HTMLInputElement>;
const formSubmit = document.getElementById('formSubmit')! as HTMLInputElement;
const formSectionPlayer = document.getElementById('form_section_player')!;

const playerBox = document.getElementById('player_box')!;
const playerCode = document.getElementById('player_code')!;
const playerLeaderboard = document.getElementById('player_leaderboard')!;
const playerBuzzer = document.getElementById('player_buzzer')!;

const adminBox = document.getElementById('admin_box')!;
const adminCode = document.getElementById('admin_code')!;
const adminLeaderboard = document.getElementById('admin_leaderboard')!;
const adminBuzzboard = document.getElementById('admin_buzzboard')!;
const adminBuzzer = document.getElementById('admin_buzzer')!;

const resetall = document.getElementById('reset_all')!;

function prompt(question: string, defaultText: string = '', maxLength: number = 0): Promise<string | null> {
    dialogQuestion.innerText = question;
    dialogAnswer.value = defaultText;
    if (maxLength > 0) {
        dialogAnswer.maxLength = maxLength;
        dialogAnswer.placeholder = `Max ${maxLength} chars`
    } else {
        dialogAnswer.removeAttribute('maxLength');
        dialogAnswer.placeholder = defaultText;
    }
    let res: (value: string | null) => void;
    let promise = new Promise<string | null>((resolve) => {res = resolve});
    dialogCancel.addEventListener('click', () => {dialog.close(); res(null)}, {once: true});
    dialogForm.addEventListener('submit', () => {dialog.close(); res(dialogAnswer.value)}, {once: true});
    dialog.showModal();
    return promise;
}

roleRadios.forEach(radio => {
    radio.removeAttribute('checked')
    radio.addEventListener('change', () => {
        formSectionPlayer.classList.toggle('vishidden', radio.value === 'admin');
        name.required = code.required = radio.value === 'player';
    });
});
name.maxLength = MAX_NAME_LENGTH;

connectForm.addEventListener('submit', () => {
    let buzzed = false;
    let locked = true;
    let controller = new AbortController();
    const signal = controller.signal;
    let resolve: (value: string) => void, reject: (reason?: any) => void;
    let block = notifier.async(new Promise<string>((res, rej) => {resolve = res; reject = rej}), ()=>{}, ()=>{});//function(error){console.log('received err', error)});
    let role = Array.from(roleRadios).filter(e=>e.checked)[0].value;

    formSubmit.disabled = true;
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(/*'localhost:6600'*/window.location.host, {
        reconnection: false,
        auth: {
            role: role,
            code: code.value,
            name: name.value
        }
    });

    socket.on('connect', async () => {
        resolve('positive resolution');
        await block;
        notifier.success('Connected to server!')
        connectBox.classList.add('hidden');
        playerBox.classList.toggle('hidden', role === 'admin');
        adminBox.classList.toggle('hidden', role === 'player');
    });

    socket.on('connect_error', err => disconnectHandler(err))
    socket.on('disconnect', err => disconnectHandler(err))

    async function disconnectHandler(err: Error | Socket.DisconnectReason){
        controller.abort(err.toString());
        playerBox.classList.add('hidden');
        adminBox.classList.add('hidden');
        connectBox.classList.remove('hidden');
        formSubmit.disabled = false;
        code.value = '';
        reject('negative resolution');
        await block;
        notifier.alert(err.toString());
        // don't reset name
    }

    function kickCurry(sid: string){
        return () => {
            socket.emit('kick', sid);
        }
    }
    function resetCurry(sid: string){
        return () => {
            socket.emit('reset', sid);
        }
    }
    function renameCurry(sid: string, oldName: string){
         return async () => {
            let newName = await prompt(`Enter a new name for user ${sid}:`, oldName, MAX_NAME_LENGTH);
            if (!newName) return;
            socket.emit('rename', sid, newName);
        }
    }
    function plusCurry(sid: string){
        return () => {
            socket.emit('plus', sid);
        }
    }
    function minusCurry(sid: string){
        return () => {
            socket.emit('minus', sid);
        }
    }

    socket.on('leaderboard', (data) => {
        if (role === 'player'){
            playerCode.textContent = data.code;
            playerLeaderboard.innerHTML = '';
            data.players.forEach((e, i)=>{
                let tr = document.createElement('tr');
                let rank = document.createElement('td');
                rank.innerHTML = (i+1).toString();
                rank.classList.add('right');
                let name = document.createElement('td');
                name.innerText = e.name;
                let points = document.createElement('td');
                points.innerText = e.points.toString();
                points.classList.add('points');
                if (e.sid == socket.id) {
                    tr.classList.add('me');
                    name.innerText += ' (you)';
                }
                tr.appendChild(rank)
                tr.appendChild(name);
                tr.appendChild(points);
                playerLeaderboard.appendChild(tr);
            });
        } else {
            adminCode.textContent = data.code;
            adminLeaderboard.innerHTML = '';
            data.players.forEach((e)=>{
                let tr = document.createElement('tr');
                let actions = document.createElement('td');

                let kickbtn = document.createElement('i');
                kickbtn.classList.add('fa-solid', 'fa-user-xmark')
                kickbtn.ariaLabel = kickbtn.title = 'Kick Player'
                kickbtn.addEventListener('click', kickCurry(e.sid));

                let resetbtn = document.createElement('i');
                resetbtn.classList.add('fa-solid', 'fa-thumbtack-slash');
                resetbtn.ariaLabel = resetbtn.title = 'Reset Buzzer';
                resetbtn.addEventListener('click', resetCurry(e.sid));

                let renamebtn = document.createElement('i');
                renamebtn.classList.add('fa-solid', 'fa-pen-to-square');
                renamebtn.ariaLabel = renamebtn.title = 'Rename Player';
                renamebtn.addEventListener('click', renameCurry(e.sid, e.name));

                let plusbtn = document.createElement('i');
                plusbtn.classList.add('fa-solid', 'fa-plus');
                plusbtn.ariaLabel = plusbtn.title = 'Increment Score';
                plusbtn.addEventListener('click', plusCurry(e.sid));

                let minusbtn = document.createElement('i');
                minusbtn.classList.add('fa-solid', 'fa-minus');
                minusbtn.ariaLabel = minusbtn.title = 'Decrement Score';
                minusbtn.addEventListener('click', minusCurry(e.sid));

                actions.appendChild(kickbtn)
                actions.appendChild(resetbtn)
                actions.appendChild(renamebtn)
                actions.appendChild(plusbtn)
                actions.appendChild(minusbtn)
                actions.classList.add('right');
                let name = document.createElement('td');
                name.innerText = e.name;
                let points = document.createElement('td');
                points.innerText = e.points.toString();
                points.classList.add('points');
                tr.appendChild(actions)
                tr.appendChild(name);
                tr.appendChild(points);
                adminLeaderboard.appendChild(tr);
            });
        }
    });
    socket.on('buzzstate', (data) => {
        if (role === 'player'){
            buzzed = data.buzzed;
            locked = data.locked;
            playerBuzzer.classList.toggle('green', buzzed)
            playerBuzzer.classList.toggle('yellow', locked);
            playerBuzzer.innerText = locked ? 'LOCKED' : (buzzed ? 'Already Buzzed' : 'Buzz In');
        }
    });
    socket.on('adminbuzzstate', (data) => {
        if (role === 'admin') {
            locked = data.locked;
            adminBuzzer.classList.toggle('green', locked);
            adminBuzzer.innerText = locked ? 'Start Round' : 'End Round';
            adminBuzzboard.innerHTML = '';
            data.players.forEach((e, i)=> {
                let tr = document.createElement('tr');
                let rank = document.createElement('td');
                rank.innerHTML = (i+1).toString();
                rank.classList.add('right');
                let name = document.createElement('td');
                name.innerText = e.name;
                let answer = document.createElement('td');
                answer.innerText = e.answer;
                tr.appendChild(rank)
                tr.appendChild(name);
                tr.appendChild(answer);
                adminBuzzboard.appendChild(tr);
            });
        }
    });

    resetall.addEventListener('click', () => {
        socket.emit('resetall');
    }, {signal});

    playerBuzzer.addEventListener('click', async () => {
        if (buzzed || locked) return;
        let answer = await prompt('What\'s your answer?', '', MAX_ANSWER_LENGTH);
        if (!answer) return;
        buzzed = true;
        socket.emit('buzz', answer);
    }, {signal});

    adminBuzzer.addEventListener('click', () => {
        if (locked) {
            socket.emit('unlock');
        } else {
            socket.emit('lock');
        }
        locked = !locked;
    }, {signal});

    return false;
});