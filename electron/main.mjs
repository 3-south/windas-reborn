// Desktop wrapper: the same web app in a window, with Web Serial and folder access enabled.
import { app, BrowserWindow, dialog, session } from 'electron';
import { fileURLToPath } from 'node:url';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1180, height: 780, minWidth: 760, minHeight: 520, autoHideMenuBar: true, title: 'WinDAS Reborn' });

  // Chromium asks the host to choose a serial port; show the available ones.
  win.webContents.session.on('select-serial-port', async (event, ports, _wc, callback) => {
    event.preventDefault();
    if (!ports.length) { callback(''); return; }
    if (ports.length === 1) { callback(ports[0].portId); return; }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', message: 'Select the serial adapter', cancelId: ports.length,
      buttons: [...ports.map((p) => `${p.displayName ?? p.portName} (${p.portName})`), 'Cancel'],
    });
    callback(response < ports.length ? ports[response].portId : '');
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setDevicePermissionHandler(() => true);

  win.loadFile(fileURLToPath(new URL('../index.html', import.meta.url)));
});

app.on('window-all-closed', () => app.quit());
