const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

const KEYFILEPATH = 'striped-century-465512-h7-67fe694d126d.json'; // Update this path
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
const drive = google.drive({ version: 'v3', auth });

const FOLDER_ID = '0ABy-Sqn_BCXPUk9PVAfolders/1FSeZ7P7DbLBRQC--uHXV0-TTFTaCsbYx'; // Update this

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const fileMetadata = {
      name: req.file.originalname,
      parents: [FOLDER_ID],
    };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    fs.unlinkSync(req.file.path); // Clean up temp file
    res.status(200).json({ fileId: file.data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('Server started on port 3001'));