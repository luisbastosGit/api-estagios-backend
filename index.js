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

app.use(cors({ origin: 'https://luisbastosgit.github.io' }));
app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES
// =================================================================

/**
 * Função para converter um índice de coluna (0-based) em sua letra (A, B, ..., Z, AA, AB).
 */
function columnIndexToLetter(index) {
  let temp, letter = '';
  while (index >= 0) {
    temp = index % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

/**
 * NOVA FUNÇÃO: Calcula a média de um array de notas em string.
 */
function calculateAverage(grades) {
  const validGrades = grades
    .map(grade => parseFloat(String(grade || '0').replace(',', '.'))) // Converte "8,5" para 8.5
    .filter(grade => grade > 0); // Ignora notas zeradas

  if (validGrades.length === 0) return '';
  
  const sum = validGrades.reduce((acc, grade) => acc + grade, 0);
  const average = sum / validGrades.length;
  
  // Retorna a média formatada com duas casas decimais e vírgula
  return average.toFixed(2).replace('.', ',');
}


/**
 * Função principal para autenticar com a API do Google.
 */
async function getAuth() {
  // Lê as credenciais da variável de ambiente que configuramos no Render
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

  const auth = new google.auth.GoogleAuth({
    credentials, // Usa as credenciais lidas da variável
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  return { googleSheets };
}

// =================================================================
// MIDDLEWARE DE SEGURANÇA (O "PORTEIRO")
// =================================================================
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

// Endpoint de Login
app.post('/login', async (req, res) => {
    // ... (código do login, sem alterações) ...
});


// Endpoint para Buscar Dados dos Alunos
app.post('/student-data', authenticateToken, async (req, res) => {
    // ... (código de busca de dados, sem alterações) ...
});


// Endpoint para Atualizar Notas (CORRIGIDO com cálculo de média)
app.post('/update-grades', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está tentando atualizar notas...`);
  try {
    const { idRegistro, notaSupervisor, notaRelatorio, notaDefesa, observacoes } = req.body;
    const { googleSheets } = await getAuth();
    
    // Calcula a média ANTES de enviar para a planilha
    const mediaFinal = calculateAverage([notaSupervisor, notaRelatorio, notaDefesa]);

    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });
    
    const rows = studentSheet.data.values || [];
    const headers = rows[0];
    
    const columnIndexes = {
        idRegistro: headers.indexOf('idRegistro'),
        orientador: headers.indexOf('nome-orientador'),
        notaSupervisor: headers.indexOf('Nota Supervisor'),
        notaRelatorio: headers.indexOf('Nota Relatório'),
        notaDefesa: headers.indexOf('Nota da Defesa'),
        media: headers.indexOf('Média'), // <-- Adicionamos a coluna da Média
        observacoes: headers.indexOf('Observações')
    };

    for (const [key, value] of Object.entries(columnIndexes)) {
        if (value === -1) {
            return res.status(500).json({ success: false, message: `Erro de configuração: A coluna "${key}" não foi encontrada na planilha.` });
        }
    }

    let targetRowIndex = -1;
    for(let i = 1; i < rows.length; i++) {
        if(rows[i][columnIndexes.idRegistro] && rows[i][columnIndexes.idRegistro].trim() === idRegistro.trim()) {
            targetRowIndex = i;
            break;
        }
    }

    if (targetRowIndex === -1) {
        return res.status(404).json({ success: false, message: "Aluno com o ID fornecido não encontrado." });
    }

    const orientadorDoAluno = rows[targetRowIndex][columnIndexes.orientador];
    if (orientadorDoAluno.trim().toUpperCase() !== req.user.nome.trim().toUpperCase()) {
        return res.status(403).json({ success: false, message: "Acesso negado: Você não é o orientador deste aluno." });
    }

    const notaSupCol = columnIndexToLetter(columnIndexes.notaSupervisor);
    const notaRelCol = columnIndexToLetter(columnIndexes.notaRelatorio);
    const notaDefCol = columnIndexToLetter(columnIndexes.notaDefesa);
    const mediaCol = columnIndexToLetter(columnIndexes.media); // <-- Adicionamos a letra da coluna da Média
    const obsCol = columnIndexToLetter(columnIndexes.observacoes);
    const rowNumber = targetRowIndex + 1;

    await googleSheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
                { range: `Página1!${notaSupCol}${rowNumber}`, values: [[notaSupervisor]] },
                { range: `Página1!${notaRelCol}${rowNumber}`, values: [[notaRelatorio]] },
                { range: `Página1!${notaDefCol}${rowNumber}`, values: [[notaDefesa]] },
                { range: `Página1!${mediaCol}${rowNumber}`, values: [[mediaFinal]] }, // <-- Adicionamos a Média na atualização
                { range: `Página1!${obsCol}${rowNumber}`, values: [[observacoes]] },
            ]
        }
    });

    console.log(`Notas do registro ${idRegistro} atualizadas com sucesso.`);
    res.json({ success: true, message: "Notas salvas com sucesso!" });

  } catch (error) {
    console.error('ERRO AO ATUALIZAR NOTAS:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao salvar as notas.' });
  }
});


// Inicia o servidor da API
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});