import YahooFinance from "yahoo-finance2";
import { MongoClient } from "mongodb";
import axios from "axios";
import nodemailer from "nodemailer";


const userUrl = 'https://mfpwa-middleware.netlify.app/api/user';
const noteUrl = 'https://mfpwa-middleware.netlify.app/api/note';
const pushUrl = 'https://mfpwa-middleware.netlify.app/api/push';

let confToUpdate = [];
// 🔹 Connessione MongoDB
const uri = "mongodb+srv://GU_user:OkkekcaFvqBlwRCU@cluster-gu.wsk3yry.mongodb.net/authDB?retryWrites=true&w=majority&appName=Cluster-GU";
const client = new MongoClient(uri);
var token;
var messageMail = "";

// EMXC.DE - MSCI Emerging Markets Ex China USD (Acc)
// VWCE.DE - FTSE All-World USD (Acc)
// SXRZ.DE - Nikkei 225 JPY (Acc)
// VGWL.DE - FTSE All-World USD (Dist)
// LYP6.DE - Core Stoxx Europe 600 EUR (Acc)
// EUNL.DE - Core MSCI World USD (Acc)
const etf_ticker_list = ["EMXC.DE","VWCE.DE","SXRZ.DE","VGWL.DE","LYP6.DE","EUNL.DE"];

async function checkExecutionOnLastMinute(db) {
  const locks = db.collection("locks");

  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

  const existing = await locks.findOne({ createdAt: { $gte: oneMinuteAgo } });
  if (existing) {
    console.log("Esecuzione già avvenuta nell'ultimo minuto");
    return true;
  } else  {
    // console.log("Esecuzione non avvenuta nell'ultimo minuto");
    await locks.deleteMany({});
    await locks.insertOne({ createdAt: now });
    return false;
  }
}


// 🔹 Gestione stato 0
function manage_ETF_state_0(etf_info, row) {
  if (row.open > etf_info.max_value_recorded || row.close > etf_info.max_value_recorded) {
    console.log("valore massimo trovato");
    etf_info.max_value_recorded = Math.max(row.open, row.close);
    etf_info.max_value_date = row.date;
    console.log(`Nuovo valore massimo: ${etf_info.max_value_recorded}`);
    
    // sendPush(`ETF ${etf_info.id} - Valore massimo trovato`, `Nuovo valore: ${etf_info.max_value_recorded}`);
    messageMail += `ETF ${etf_info.id} - Valore massimo trovato\nNuovo valore: ${etf_info.max_value_recorded}\n\n`;
  } else if (row.close < etf_info.max_value_recorded * (1 - etf_info.perc_down)) {
    console.log("Cambio stato a 1");
    etf_info.fase_id = 1;
    etf_info.date_selected_to_buy = row.date;
    etf_info.price_selected_to_buy = row.close;
    etf_info.selling_comparing =
      etf_info.selling_comparing_parameter === "localMax"
      ? etf_info.max_value_recorded
      : row.close;

      console.log(`Prezzo selezionato per acquisto: ${etf_info.price_selected_to_buy}`);
      
      // sendPush(`ETF ${etf_info.id} - Cambio stato a 1`, `Data acquisto: ${etf_info.date_selected_to_buy.toISOString().split("T")[0]}\nPrezzo acquisto: ${etf_info.price_selected_to_buy}`);
      messageMail += `ETF ${etf_info.id} - Cambio stato a 1\nData acquisto: ${etf_info.date_selected_to_buy.toISOString().split("T")[0]}\nPrezzo acquisto: ${etf_info.price_selected_to_buy}\n\n`;
    }
}

// 🔹 Gestione stato 1
function manage_ETF_state_1(etf_info, row) {
  if (row.open > etf_info.selling_comparing * (1 + etf_info.perc_up)) {
    console.log("Cambio stato a 2");
    etf_info.fase_id = 2;
    etf_info.date_selected_to_sell = row.date;
    etf_info.price_selected_to_sell = row.open;

    console.log(`Prezzo selezionato per vendita: ${etf_info.price_selected_to_sell}`);
    // sendPush(`ETF ${etf_info.id} - Cambio stato a 2`, `Data vendita: ${etf_info.date_selected_to_sell.toISOString().split("T")[0]}\nPrezzo vendita: ${etf_info.price_selected_to_sell}`);
    messageMail += `ETF ${etf_info.id} - Cambio stato a 2\nData vendita: ${etf_info.date_selected_to_sell.toISOString().split("T")[0]}\nPrezzo vendita: ${etf_info.price_selected_to_sell}\n\n`;
  }
}

// 🔹 Gestione stato 2
function manage_ETF_state_2(etf_info) {
  console.log("Fase 2 gestita");
}

// 🔹 Funzione principale di valutazione
async function valuta_ETF(date_to_evaluate, date_to_valuate_end, db) {
  console.log(
    `Data di valutazione: ${date_to_evaluate.toISOString().split("T")[0]}`
  );

  const collection = db.collection("ETF_status");

  for (let ticker of etf_ticker_list) {
    let etf_info = await collection.findOne({ id: ticker });

    if (etf_info) {
      console.log(`\nValutazione ETF: ${ticker}`);

      console.log('date_to_evaluat ' +date_to_evaluate);
      console.log('date_to_valuate_end ' +date_to_valuate_end);

      // Yahoo finance con chart()
      const yahooFinance = new YahooFinance();
      const chart = await yahooFinance.chart(ticker, {
        period1: date_to_evaluate,
        period2: date_to_valuate_end,
        interval: "1d",
      });


      // console.log(`numero righe quote ricevute: ${chart.quotes.length}`);
      if (chart.quotes.length > 0) {
        let data = chart.quotes.at(-1);
        const row = {
          date: data.date,
          open: data.open,
          close: data.close,
        };

        switch (etf_info.fase_id) {
          case 0:
            manage_ETF_state_0(etf_info, row);
            break;
          case 1:
            manage_ETF_state_1(etf_info, row);
            break;
          case 2:
            manage_ETF_state_2(etf_info);
            break;
          default:
            console.log(
              `Fase non prevista per ETF ${ticker}: ${etf_info.fase_id}`
            );
        }
      }

      await collection.updateOne({ _id: etf_info._id }, { $set: etf_info });
      confToUpdate.push(formatNote(etf_info));
    }
  }

  refreshNote();
}

function formatNote(etf_info) {
  return {
    id: etf_info.id,
    name: etf_info.id,
    items: [
      { id: etf_info.id + "_0", label: `Inizio osservazione: ${formatDate(etf_info.osservation_startDate)}` },
      { id: etf_info.id + "_1", label: `Valore max locale: ${formatNumber(etf_info.max_value_recorded)}` },
      { id: etf_info.id + "_2", label: `Data max locale: ${formatDate(etf_info.max_value_date)}` },
      { id: etf_info.id + "_3", label: `Percentuale down: ${etf_info.perc_down}` },
      { id: etf_info.id + "_4", label: `Percentuale up: ${etf_info.perc_up}` },
      { id: etf_info.id + "_5", label: `Prezzo di confronto per vendita: ${formatNumber(etf_info.selling_comparing)}` },
      { id: etf_info.id + "_6", label: `Parametro di selezione prezzo vendita: ${etf_info.selling_comparing_parameter}` },
      { id: etf_info.id + "_7", label: `Prezzo osservato di acquisto: ${formatNumber(etf_info.price_selected_to_buy)}` },
      { id: etf_info.id + "_8", label: `Data di prezzo osservato di acquisto: ${formatDate(etf_info.date_selected_to_buy)}` },
      { id: etf_info.id + "_9", label: `Id Stato: ${etf_info.fase_id}` },
      { id: etf_info.id + "_10", label: `Prezzo individuato di vendita: ${formatNumber(etf_info.price_selected_to_sell)}` },
      { id: etf_info.id + "_11", label: `Data individuata di vendita: ${formatDate(etf_info.date_selected_to_sell)}` }
    ]
  }
}

async function getToken(email, password){
  const configuration = {
                            method: "post",
                            url: userUrl + "/login",
                            data: {
                                email,
                                password,
                            },
                        };
  let resp = await axios(configuration);
  return resp;
}

function formatDate(dateInput) {
  const date = new Date(dateInput); // accetta stringa ISO o oggetto Date
  if (isNaN(date)) return ''; // gestisce casi invalidi

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function formatNumber(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return ''; // gestisce valori non numerici
  return num.toFixed(2); // restituisce una stringa con 2 decimali
}

async function sendPush(usersId, title, message) {
  console.log(`Invio notifica: ${title} - ${message}`);
  const configuration = {
                          method: "post",
                          url: pushUrl + "/sendNotification",
                          data: {
                              usersId: usersId,
                              title,
                              message
                          },
                          headers: {
                                      Authorization: `Bearer ${token}`,
                                    }
                        };

  let resp = await axios(configuration);
  console.log(`Notifica inviata, risposta: ${resp.status} - ${resp.statusText}`);
  return resp;
}

// Funzione per inviare una mail
async function sendMail(text) {
  // Configura il trasportatore SMTP (esempio con Gmail)
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "ucciardi.giovanni@gmail.com",
      pass: "jgpfhfsmgmtpcxgp", // Usa una password per app, non la password normale!
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // Imposta i dettagli della mail
  let mailOptions = {
    from: "checkEtfNews@gmail.com",
    to: "ucciardi.giovanni@gmail.com",
    subject: "Aggiornamento ETF",
    text: text,
  };

  // Invia la mail
  let info = await transporter.sendMail(mailOptions);
  // console.log("Email inviata: " + info.response);
  return info;
}

async function refreshNote() {
  let note = await getGlobalNote();

  for (let newConf  of confToUpdate) {
    const target = note.list.find(item => item.name === newConf.name);
    if (target) {
      target.items = newConf.items;
    } else {
      note.list.push(newConf);
    }
  }
  // console.log("Nota aggiornata: " + JSON.stringify(note, null, 2));
  updateNote(note);
  // console.log("Nota aggiornata");
}

async function getGlobalNote() {
  const configuration = {
                          method: "get",
                          url: noteUrl + "/get/68e036038cc00ac45ef3a521",
                          headers: {
                                      Authorization: `Bearer ${token}`,
                                    }
                        };
  
  response = await axios(configuration);
  if (response.status === 200) {
    return response.data.result;
    // console.log('Risposta ricevuta: ' + JSON.stringify(response.data.result, null, 2));
  }

  return null;
}

function updateNote(note) {
  const configuration = {
            method: "post",
            url: noteUrl + "/update",
            data: {
                noteId: "68e036038cc00ac45ef3a521",
                note: note
            },
            headers: {
                        Authorization: `Bearer ${token}`,
                      }
        };
    
    return axios(configuration);

} 

// 🔹 Esecuzione
export const handler = async (event, context) => {
  

  const today = new Date();
  const dayOfWeek = today.getDay();
  // Data di ieri
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayOfWeek === 0 || dayOfWeek === 6) { // Se è domenica o sabato
    console.log("Oggi è weekend, nessuna valutazione effettuata.");
    return;
  }

  await client.connect();
  const db = client.db("authDB");

  if (await checkExecutionOnLastMinute(db)) { // Per qualche motivo Netlify lancia più volte la funzione
    await client.close();                     // questo serve a bloccare le esecuzioni multiple
    return; 
  }

  respToken = await getToken("zqzqx_9@hotmail.com","aaa");
  if (respToken.status === 200) {
      token =  respToken.data.details.token;
  }

  await valuta_ETF(yesterday, today, db);

  if (messageMail !== "") {
    // await sendMail(messageMail);
    sendPush('67ae28d66c8c8c032658795f', 'Aggiornamento ETF', messageMail); // sendPush('', 'Aggiornamento ETF', messageMail)
    console.log("Notifica inviata: " + messageMail);
  } else {
    //await sendMail("nessun aggiornamento sugli ETF in data: " + today.toISOString().split("T")[0]);
    console.log("Nessun aggiornamento sugli ETF");
  }
  await client.close();  
}