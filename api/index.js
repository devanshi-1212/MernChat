const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const express = require('express');
const bcrypt = require('bcryptjs');
const ws = require('ws');
const fs = require('fs');
const User = require('./models/User');
const Message = require('./models/Message');

dotenv.config();
// console.log(process.env.MONGO_URL);
mongoose.connect(process.env.MONGO_URL);
const jwtSecret = process.env.JWT_SECRET;
const bcryptSalt = bcrypt.genSaltSync(10);

const app = express();

app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
}))

async function getUserDataFromRequest(req) {
    return new Promise((resolve, reject) => {
        const token = req.cookies?.token;

        if(token) {
            jwt.verify(token, jwtSecret, {}, (err, userData) => {
                if(err) throw err;
                resolve(userData);
            });
        }

        else {
            reject('no token');
        }
    });
}

app.get('/test', (req, res) => {
    res.json('test ok');
});

app.get('/messages/:userId', async (req, res) => {
    const {userId} = req.params;
    const userData = await getUserDataFromRequest(req);
    const ourUserId = userData.userId;
    // console.log({userId, ourUserId});
    const messages = await Message.find({
        sender: {$in: [userId, ourUserId]},
        recipient: {$in: [userId, ourUserId]},
    }).sort({createdAt: 1});

    res.json(messages);
});

app.get('/people', async (req, res) => {
    const users = await User.find({}, {'_id': 1, username: 1});
    res.json(users);
});

app.get('/profile', (req, res) => {
    const token = req.cookies?.token;

    if(token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
            if(err) throw err;
            res.json(userData);
        });
    }

    else {
        res.status(401).json('no token');
    }
});

app.post('/login', async (req, res) => {
    const {username, password} = req.body;
    const foundUser = await User.findOne({username});

    if(foundUser) {
        const passOk = bcrypt.compareSync(password, foundUser.password);

        if(passOk) {
            jwt.sign({userId: foundUser._id, username}, jwtSecret, {}, (err, token) => {
                res.cookie('token', token, {sameSite: 'none', secure: true}).json({
                    id: foundUser._id,
                });
            });
        }
    }
})

app.post('/logout', (req, res) => {
    res.cookie('token', '', {sameSite: 'none', secure: true}).json('ok');
})

app.post('/register', async (req, res) => {
    const {username, password} = req.body;

    try {
        const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
        
        const createdUser = await User.create({
            username: username,
            password: hashedPassword,
        });

        jwt.sign({userId: createdUser._id, username}, jwtSecret, {}, (err, token) => {
            if(err) throw err;
    
            //status 201 means created
            res.cookie('token', token, {sameSite: 'none', secure: true}).status(201).json({
                id: createdUser._id,
            });
        });
    }
    catch(err) {
        if(err) throw err;
        res.status(500).json('error');
    }
});

const server = app.listen(4000);

const wss = new ws.WebSocketServer({server});

wss.on('connection', (connection, req) => {

    function notifyAboutOnlinePeople() {
        //we have 2 connections as react will render every component 2 times thats why clg is 2 below
        // console.log([...wss.clients].map(c => c.username));
        //notify everyone about online people (when someone connects)
        [...wss.clients].forEach(client => {
            client.send(JSON.stringify({
                online: [...wss.clients].map(c => ({userId: c.userId, username: c.username}))
            }));
        });
    }

    connection.isAlive = true;

    connection.timer = setInterval(() => {
        connection.ping();
        connection.deathTimer = setTimeout(() => {
            connection.isAlive = false;
            clearInterval(connection.timer);
            connection.terminate();
            notifyAboutOnlinePeople();
            // console.log('dead');
        }, 1000);
    }, 5000);

    connection.on('pong', () => {
        clearTimeout(connection.deathTimer);        
    })
    
    //read username and id from cookie for this connection
    const cookies = req.headers.cookie;

    if(cookies) {
        const tokenCookieString = cookies.split(';').find(str => str.startsWith('token='));

        if(tokenCookieString) {
            const token = tokenCookieString.split('=')[1];

            if(token) {
                jwt.verify(token, jwtSecret, {}, (err, userData) => {
                    if(err) throw err;
                    // console.log(userData);

                    const {userId, username} = userData;
                    connection.userId = userId;
                    connection.username = username;
                });
            }
        }
    }

    connection.on('message', async (message, isBinary) => {
        const messageData = JSON.parse(message.toString());
        // console.log(messageData);

        const {recipient, text, file} = messageData;
        let filename = null;

        if(file) {
            const parts = file.name.split('.');
            const ext = parts[parts.length - 1];
            const path = __dirname + '/uploads/' + filename;
            const bufferData = Buffer.from(file.data.split(',')[1], 'base64');

            filename = Date.now() + '.' +ext;

            fs.writeFile(path, bufferData, () => {
                console.log('file saved : ', path);
            })
        }

        if(recipient && (text || file)) {
            const messageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
                file: file ? filename : null,
            });

            [...wss.clients]
                .filter(c => c.userId === recipient)
                .forEach(c => c.send(JSON.stringify({
                    text,
                    sender: connection.userId,
                    recipient,
                    file: file ? filename : null,
                    _id: messageDoc._id,
                })));
        }
    });

     //notify everyone about online people (when someone connects)
     notifyAboutOnlinePeople();
});

// wss.on('close', (data) => {
//     console.log("disconnect", data);
// })

//pwd - rKSdtfxf4r93wZEs
