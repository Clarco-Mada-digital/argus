const { app, BrowserWindow } = require('electron');

function creerFenetre() {
  const fenetre = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  fenetre.loadURL('https://app.exemple.com');
}

app.whenReady().then(creerFenetre);
