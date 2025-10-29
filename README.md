# MathBuzzer
Buzzer system for math team competitions


Client connects w/ display name and game code as auth
(right now the only valid game code is 123456)


PER JOIN:
Server adds player info to game state dictionary with UUIDv7: name, points=0, discriminator=6-truncated hash of UUID
Server sends player info for display on client
Server sends all player infos to admin

ANSWERING QUESTIONS:
//Server sends player activation dict to client: timer state dict, leaderboard
Whenever, client sends answer to server

ADMIN PANEL:
When an answer is submitted, send it to the client