import yahooFinance from "yahoo-finance2";
import { MongoClient } from "mongodb";
import axios from "axios";


const userUrl = 'https://mfpwa-middleware.netlify.app/api/user';
const noteUrl = 'https://mfpwa-middleware.netlify.app/api/note';
const pushUrl = 'https://mfpwa-middleware.netlify.app/api/push';

let confToUpdate = [];
// 🔹 Connessione MongoDB
const uri = "mongodb+srv://GU_user:OkkekcaFvqBlwRCU@cluster-gu.wsk3yry.mongodb.net/authDB?retryWrites=true&w=majority&appName=Cluster-GU";
const client = new MongoClient(uri);
let token;

const etf_ticker_list = ["EMXC.DE"]; //,"VWCE.DE","SXRZ.DE","VGWL.DE","LYP6.DE"]

async function checkExecutionOnLastMinute(db) {
  const locks = db.collection("locks");

  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

  const existing = await locks.findOne({ createdAt: { $gte: oneMinuteAgo } });
  if (existing) {
    console.log("Esecuzione già avvenuta nell'ultimo minuto");
    return true;
  } else  {
    console.log("Esecuzione non avvenuta nell'ultimo minuto");
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
  } else if (row.close < etf_info.max_value_recorded * (1 - etf_info.perc_down)) {
    console.log("Cambio stato a 1");
    etf_info.fase_id = 1;
    etf_info.date_selected_to_buy = row.date;
    etf_info.price_selected_to_buy = row.close;
    etf_info.selling_comparing =
      etf_info.selling_comparing_parameter === "localMax"
      ? etf_info.max_value_recorded
      : row.close;

      sendPush(`ETF ${etf_info.id} - Cambio stato a 1`, `Data acquisto: ${etf_info.date_selected_to_buy.toISOString().split("T")[0]}\nPrezzo acquisto: ${etf_info.price_selected_to_buy}`);
  }
}

// 🔹 Gestione stato 1
function manage_ETF_state_1(etf_info, row) {
  if (row.open > etf_info.selling_comparing * (1 + etf_info.perc_up)) {
    console.log("Cambio stato a 2");
    etf_info.fase_id = 2;
    etf_info.date_selected_to_sell = row.date;
    etf_info.price_selected_to_sell = row.open;

    sendPush(`ETF ${etf_info.id} - Cambio stato a 2`, `Data vendita: ${etf_info.date_selected_to_sell.toISOString().split("T")[0]}\nPrezzo vendita: ${etf_info.price_selected_to_sell}`);
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
      // Yahoo finance con chart()
      const chart = await yahooFinance.chart(ticker, {
        period1: date_to_evaluate,
        period2: date_to_valuate_end,
        interval: "1d",
      });

      if (chart.quotes.length > 0) {
        const row = {
          date: chart.quotes[0].date,
          open: chart.quotes[0].open,
          close: chart.quotes[0].close,
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
      { id: "0", label: `Inizio osservazione: ${formatDate(etf_info.osservation_startDate)}` },
      { id: "1", label: `Valore max locale: ${formatNumber(etf_info.max_value_recorded)}` },
      { id: "2", label: `Data max locale: ${formatDate(etf_info.max_value_date)}` },
      { id: "3", label: `Percentuale down: ${etf_info.perc_down}` },
      { id: "4", label: `Percentuale up: ${etf_info.perc_up}` },
      { id: "5", label: `Prezzo di confronto per vendita: ${formatNumber(etf_info.selling_comparing)}` },
      { id: "6", label: `Parametro di selezione prezzo vendita: ${etf_info.selling_comparing_parameter}` },
      { id: "7", label: `Prezzo osservato di acquisto: ${formatNumber(etf_info.price_selected_to_buy)}` },
      { id: "8", label: `Data di prezzo osservato di acquisto: ${formatDate(etf_info.date_selected_to_buy)}` },
      { id: "9", label: `Id Stato: ${etf_info.fase_id}` },
      { id: "10", label: `Prezzo individuato di vendita: ${formatNumber(etf_info.price_selected_to_sell)}` },
      { id: "11", label: `Data individuata di vendita: ${formatDate(etf_info.date_selected_to_sell)}` }
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

async function sendPush(title, message) {
  const configuration = {
                          method: "post",
                          url: pushUrl + "/sendNotification",
                          data: {
                              usersId: "67ae28d66c8c8c032658795f",
                              title,
                              message
                          },
                          headers: {
                                      Authorization: `Bearer ${token}`,
                                    }
                        };

  let resp = await axios(configuration);
  return resp;
}

async function notifica(titolo, messaggio) {
  if (respToken.status === 200) {
      respPush = sendPush(titolo, messaggio);
  }
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
  console.log("Nota aggiornata: ");
  
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
  await client.connect();
  const db = client.db("authDB");
  if (await checkExecutionOnLastMinute(db)) {
    return; 
  }

  console.log("Eseguo");
  respToken = await getToken("zqzqx_9@hotmail.com","aaa");
  if (respToken.status === 200) {
      token =  respToken.data.details.token;
  }

  try {
    for (let i = 0; i < 1; i++) {
      let date_to_evaluate = new Date(2025, 6, 1 + i); // Luglio (6 perché in JS i mesi partono da 0)
      let date_to_valuate_end = new Date(date_to_evaluate);
      date_to_valuate_end.setDate(date_to_valuate_end.getDate() + 1);
      await valuta_ETF(date_to_evaluate, date_to_valuate_end, db);
    }
  } catch (err) {
    console.error(err);
  }

  await client.close();  
}