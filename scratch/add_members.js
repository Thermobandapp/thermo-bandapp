import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Configuración (extraída de app.js)
const firebaseConfig = {
    databaseURL: "https://thermo-bandapp-default-rtdb.europe-west1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function addMember(name, code) {
    const memberRef = ref(db, `members/${name.toLowerCase()}`);
    await set(memberRef, { name, code });
    console.log(`Miembro ${name} añadido con éxito.`);
}

addMember("Fernando", "2024");
addMember("Maula", "1234");
