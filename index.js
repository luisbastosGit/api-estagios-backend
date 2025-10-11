// 1. Importar as bibliotecas
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

// 2. Configurações da API
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '105-AqvOHRe-CiB4oODYL26raXLOVBfB0jI7Z3Pm_viM';
const JWT_SECRET = 'seu-segredo-super-secreto-pode-ser-qualquer-coisa';

// Lista de sites (origens) que podem aceder a esta API
const allowedOrigins = [
  'https://luisbastosgit.github.io',
];

// Configuração final do CORS
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
      callback(null, true);
    } else {
      callback(new Error('A política de CORS para este site não permite o acesso.'));
    }
  }
}));

app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES E DE AUTENTICAÇÃO
// =================================================================

function columnIndexToLetter(index) {
  let temp, letter = '';
  while (index >= 0) {
    temp = index % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

function calculateAverage(grades) {
  const validGrades = grades
    .map(grade => parseFloat(String(grade || '0').replace(',', '.')))
    .filter(grade => grade > 0);

  if (validGrades.length === 0) return '';
  
  const sum = validGrades.reduce((acc, grade) => acc + grade, 0);
  const average = sum / validGrades.length;
  
  return average.toFixed(2).replace('.', ',');
}

async function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  return { googleSheets };
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.status(401).json({ success: false, message: "Acesso negado. Token não fornecido." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: "Token inválido ou expirado." });
    req.user = user;
    next();
  });
};

// =================================================================
// ENDPOINTS DA API
// =================================================================

app.get('/', (req, res) => {
  res.json({ message: "API do Sistema de Estágios está online!" });
});

app.post('/login', async (req, res) => {
    // Código de login sem alterações...
    // ...
});

app.get('/filter-options', async (req, res) => {
    // Código de opções de filtro sem alterações...
    // ...
});

// ENDPOINT ATUALIZADO PARA INCLUIR ESTATÍSTICAS
app.post('/student-data', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está a procurar dados de alunos...`);
  try {
    const filters = req.body;
    const { googleSheets } = await getAuth();
    
    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });

    const rows = studentSheet.data.values || [];
    const headers = rows.shift();
    
    let allData = rows.map(row => {
        const rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = row[index];
        });
        return rowObj;
    });

    // Aplica os filtros
    let filteredData = allData;
    if (filters.status) filteredData = filteredData.filter(row => row.statusPreenchimento === filters.status);
    if (filters.curso) filteredData = filteredData.filter(row => row.curso === filters.curso);
    if (filters.orientador) filteredData = filteredData.filter(row => row['nome-orientador'] === filters.orientador);
    if (filters.turma) filteredData = filteredData.filter(row => row['turma-fase'] === filters.turma);
    if (filters.nome) filteredData = filteredData.filter(row => row['nome-completo'] && row['nome-completo'].toLowerCase().includes(filters.nome.toLowerCase()));
    if (filters.ano) filteredData = filteredData.filter(row => row.matricula && row.matricula.startsWith(filters.ano));
    if (filters.cpf) filteredData = filteredData.filter(row => row.cpf && row.cpf.replace(/\D/g, '').includes(filters.cpf.replace(/\D/g, '')));
    
    // Calcula as estatísticas COM BASE NOS DADOS FILTRADOS
    const stats = {
        total: filteredData.length,
        completos: filteredData.filter(row => row.statusPreenchimento && row.statusPreenchimento.trim().toUpperCase() === 'CONCLUÍDO').length,
        pendentes: filteredData.filter(row => row.statusPreenchimento && row.statusPreenchimento.trim().toUpperCase() === 'ALUNO').length
    };

    console.log(`Encontrados ${stats.total} registos.`);
    // Retorna os dados e as estatísticas
    res.json({ success: true, data: filteredData, stats: stats });

  } catch (error) {
      console.error('ERRO AO PROCURAR DADOS DOS ALUNOS:', error);
      res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao procurar dados.' });
  }
});

app.post('/update-grades', authenticateToken, async (req, res) => {
    // Código de atualização de notas sem alterações...
    // ...
});

app.post('/complete-registration', async (req, res) => {
    // Código de registo da empresa sem alterações...
    // ...
});

// Inicia o servidor da API
app.listen(PORT, () => {
  console.log(`🚀 Servidor a rodar na porta ${PORT}`);
});

