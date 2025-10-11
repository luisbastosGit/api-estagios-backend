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

app.use(cors());
app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES
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

// =================================================================
// MIDDLEWARE DE SEGURANÇA
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

app.get('/', (req, res) => {
  res.json({ message: "API do Sistema de Estágios está online!" });
});

app.post('/login', async (req, res) => {
  console.log('Recebida requisição de login...');
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios.' });
    }

    const { googleSheets } = await getAuth();
    const usersSheet = await googleSheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: '_USUARIOS!A:C',
    });
    const users = usersSheet.data.values || [];
    let userFound = null;
    for (let i = 1; i < users.length; i++) {
      const [nome, userEmail, userPassword] = users[i];
      if (userEmail && userPassword && userEmail.toLowerCase() === email.toLowerCase() && userPassword === password) {
        userFound = { nome, email: userEmail };
        break;
      }
    }

    if (userFound) {
      const accessToken = jwt.sign(userFound, JWT_SECRET, { expiresIn: '6h' });
      res.json({ success: true, message: 'Login bem-sucedido!', user: userFound, token: accessToken });
    } else {
      res.status(401).json({ success: false, message: 'Email ou senha inválidos.' });
    }
  } catch (error) {
    console.error('ERRO NO ENDPOINT DE LOGIN:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
  }
});

app.get('/filter-options', authenticateToken, async (req, res) => {
    console.log('Buscando opções para os filtros...');
    try {
        const { googleSheets } = await getAuth();
        const sheetData = await googleSheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Página1!A:Z', // Otimizado para ler apenas colunas necessárias
        });

        const rows = sheetData.data.values || [];
        const headers = rows.shift() || [];

        const getUniqueValues = (colName) => {
            const index = headers.indexOf(colName);
            if (index === -1) return [];
            return [...new Set(rows.map(row => row[index]).filter(Boolean))].sort();
        };

        const getAnosFromMatricula = () => {
            const index = headers.indexOf('matricula');
            if (index === -1) return [];
            const anos = new Set(rows.map(row => row[index] && row[index].substring(0, 4)).filter(Boolean));
            return [...anos].sort((a, b) => b - a); // Ordena do mais novo para o mais antigo
        };
        
        res.json({
            success: true,
            data: {
                status: getUniqueValues('statusPreenchimento'),
                cursos: getUniqueValues('curso'),
                orientadores: getUniqueValues('nome-orientador'),
                turmas: getUniqueValues('turma-fase'),
                anos: getAnosFromMatricula(),
            }
        });
    } catch (error) {
        console.error('ERRO AO BUSCAR OPÇÕES DE FILTRO:', error);
        res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao carregar os filtros.' });
    }
});

app.post('/student-data', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está buscando dados de alunos...`);
  try {
    const filters = req.body;
    const { googleSheets } = await getAuth();
    
    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });

    const rows = studentSheet.data.values || [];
    const headers = rows.shift();
    let data = rows.map(row => {
        const rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = row[index];
        });
        return rowObj;
    });

    // Aplica os filtros
    let filteredData = data.filter(row => {
        const statusMatch = !filters.status || row.statusPreenchimento === filters.status;
        const cursoMatch = !filters.curso || row.curso === filters.curso;
        const orientadorMatch = !filters.orientador || row['nome-orientador'] === filters.orientador;
        const turmaMatch = !filters.turma || row['turma-fase'] === filters.turma;
        const nomeMatch = !filters.nome || (row['nome-completo'] && row['nome-completo'].toLowerCase().includes(filters.nome.toLowerCase()));
        
        // FILTRO ANO CORRIGIDO
        const anoMatch = !filters.ano || (row.matricula && row.matricula.startsWith(filters.ano));
        
        // FILTRO CPF CORRIGIDO
        const cpfOnlyNumbers = filters.cpf ? filters.cpf.replace(/\D/g, '') : '';
        const rowCpfOnlyNumbers = row.cpf ? row.cpf.replace(/\D/g, '') : '';
        const cpfMatch = !cpfOnlyNumbers || (rowCpfOnlyNumbers && rowCpfOnlyNumbers.includes(cpfOnlyNumbers));

        return statusMatch && cursoMatch && orientadorMatch && turmaMatch && nomeMatch && anoMatch && cpfMatch;
    });

    console.log(`Encontrados ${filteredData.length} registros.`);
    res.json({ success: true, data: filteredData });

  } catch (error) {
      console.error('ERRO AO BUSCAR DADOS DOS ALUNOS:', error);
      res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao buscar dados.' });
  }
});

app.post('/update-grades', authenticateToken, async (req, res) => {
  // ... (código de atualização de notas, sem alterações) ...
  console.log(`Usuário '${req.user.nome}' está tentando atualizar notas...`);
  try {
    const { idRegistro, notaSupervisor, notaRelatorio, notaDefesa, observacoes } = req.body;
    const { googleSheets } = await getAuth();
    
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
        media: headers.indexOf('Média'),
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
    const mediaCol = columnIndexToLetter(columnIndexes.media);
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
                { range: `Página1!${mediaCol}${rowNumber}`, values: [[mediaFinal]] },
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
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

