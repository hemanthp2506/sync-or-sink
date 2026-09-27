# SYNC OR SINK

A local, real-time cooperative party game for 2–8 players. One player sees a private repair instruction, another has the controls, and the whole crew shares the same ship status and timer.

## Start the game

You need Node.js installed (version 18 or newer). There are no packages to install.

1. Unzip the download.
2. Open Terminal in the `sync-or-sink` folder.
3. Run `npm start`.
4. Open **http://localhost:4173** in the browser on the computer running the server.
5. Enter your name and press **Create room**.
6. Have another player open the game on their device and enter the six-character room code.
7. When at least two players have joined, the room creator presses **Launch mission**.

For phones or laptops on the **same Wi-Fi**, open `http://YOUR-COMPUTER-IP:4173` on each other device. Replace `YOUR-COMPUTER-IP` with the computer's local network address, such as `192.168.1.25`. The host computer must stay on, the server must keep running, and the network must permit connections to port 4173. `localhost` on a phone points to the phone, not the host computer.

To stop the game, press Ctrl+C in Terminal. Rooms are stored in memory and disappear when the server stops.

## Rules

- Three rounds; three repairs per round; 90 seconds per round.
- A different player sees the private instruction from the one with the controls. Talk to coordinate.
- Correct repair: +100 points. Wrong control: -1 hull point and -5 seconds.
- At the end of each round, earn 2 points per remaining second.
- Clear all three rounds to win. Run out of time or hull points to lose.

No microphone or chat is built in. Talk in person or on a call.
