# 🐑 Black Sheep (Party Game)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Marska321/black-sheep-game)

> The hilarious online social party game where you win by thinking like the flock — and avoid becoming the **Black Sheep 🖤**!

Inspired by the board game *Herd Mentality*, re-imagined with the **Black Sheep** motif.

---

## 🎮 How the Game Works

1. **The Host** launches the game on a TV or laptop screen. A unique 4-letter Room Code and QR Code appear.
2. **Players** scan the QR code with their phones (or type `https://your-url/join/CODE`) and enter a nickname. No app install or accounts needed!
3. **Each Round:**
   - A question is revealed (e.g., *"Name a pizza topping people love or hate"*).
   - All players secretly type their answer on their phone.
4. **Scoring:**
   - 🐑 **The Majority:** The most popular answer wins! Everyone who wrote it collects **1 Wool Token**.
   - ⚡ **Tie:** If two or more answers tie for top, *nobody* gets wool this round.
   - 🖤 **The Black Sheep:** If only **one player** gives an unmatched unique answer, they become the **Black Sheep**.
   - 🚫 **The Curse:** You can still collect wool while holding the Black Sheep, but **you cannot win the game** until another player gives a lone answer and takes the curse from you!
5. **Winning:** First player to reach **8 Wool Tokens** without holding the Black Sheep wins!

---

## 🚀 Running Locally (for testing or local WiFi play)

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Start the server
npm start
```

- Open the **Host Screen** on your computer: `http://localhost:3000`
- Open the **Player Phone Screen** in another tab or phone: `http://localhost:3000/join/<ROOM_CODE>`

---

## 🌐 Deploying to Render (Free Public URL for Phones)

Render runs this Node.js + WebSocket server with an automatic free `https://` / `wss://` domain.

### Quick Step-by-Step:
1. Push this folder to a GitHub repository.
2. Go to [Render.com](https://render.com) and click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Set the following settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
5. Click **Create Web Service**.

Once deployed, Render gives you a live public URL like `https://black-sheep.onrender.com`.
- Pull up `https://black-sheep.onrender.com` on your TV / laptop.
- Everyone in the room scans the TV screen QR code with their phone camera to join!
