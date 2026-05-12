const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/genesis';

async function fixIndexes() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Conectado ao MongoDB');
    
    const db = mongoose.connection.db;
    const collections = await db.listCollections({ name: 'users' }).toArray();
    
    if (collections.length > 0) {
      console.log('Removendo índice username_1...');
      try {
        await db.collection('users').dropIndex('username_1');
        console.log('Índice username_1 removido com sucesso.');
      } catch (e) {
        if (e.codeName === 'IndexNotFound') {
          console.log('Índice username_1 não encontrado, ignorando.');
        } else {
          throw e;
        }
      }
    }
    
    console.log('Limpando usuários antigos com username nulo (opcional)...');
    // Se houver usuários sem e-mail mas com username, podemos precisar migrar.
    // Mas aqui o erro é no insert de um novo.
    
    console.log('Finalizado.');
    process.exit(0);
  } catch (err) {
    console.error('Erro ao ajustar índices:', err);
    process.exit(1);
  }
}

fixIndexes();
