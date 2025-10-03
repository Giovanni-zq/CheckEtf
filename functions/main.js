import yahooFinance from "yahoo-finance2";
import { MongoClient } from "mongodb";
import axios from "axios";

const userUrl = 'https://mfpwa-middleware.netlify.app/api/user';
const pushUrl = 'https://mfpwa-middleware.netlify.app/api/push';

// 🔹 Connessione MongoDB
const uri =
  "mongodb+srv://GU_user:OkkekcaFvqBlwRCU@cluster-gu.wsk3yry.mongodb.net/authDB?retryWrites=true&w=majority&appName=Cluster-GU";
const client = new MongoClient(uri);

const etf_ticker_list = ["EMXC.DE"]; //,"VWCE.DE","SXRZ.DE","VGWL.DE","LYP6.DE"]

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
  }
}

// 🔹 Gestione stato 1
function manage_ETF_state_1(etf_info, row) {
  if (row.open > etf_info.selling_comparing * (1 + etf_info.perc_up)) {
    console.log("Cambio stato a 2");
    etf_info.fase_id = 2;
    etf_info.date_selected_to_sell = row.date;
    etf_info.price_selected_to_sell = row.open;
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
    }
  }
}

function getToken(email, password){
    const configuration = {
                method: "post",
                url: userUrl + "/login",
                data: {
                    email,
                    password,
                },
            };
        
        return axios(configuration);
}

function sendPush(usersId, title, message, token) {
        const configuration = {
            method: "post",
            url: pushUrl + "/sendNotification",
            data: {
                usersId,
                title,
                message
            },
            headers: {
                        Authorization: `Bearer ${token}`,
                     }
        };
    
        return axios(configuration);
    }

// 🔹 Esecuzione
async function main() {
  /*try {
    await client.connect();
    const db = client.db("authDB");

    for (let i = 0; i < 60; i++) {
      let date_to_evaluate = new Date(2025, 6, 17 + i); // Luglio (6 perché in JS i mesi partono da 0)
      let date_to_valuate_end = new Date(date_to_evaluate);
      date_to_valuate_end.setDate(date_to_valuate_end.getDate() + 1);

      await valuta_ETF(date_to_evaluate, date_to_valuate_end, db);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }*/

    getToken("zqzqx_9@hotmail.com","aaa").then((result) => {
        console.log('Token: ' + result.data.details.token);
        sendPush(["67ae28d66c8c8c032658795f"], "Titolo di prova", "Messaggio di prova", result.data.details.token).catch((error) => {
            console.log('Errore invio push');
        });

    }).catch((error) => {
        console.log('Non autenticato');
    })
}

main();
