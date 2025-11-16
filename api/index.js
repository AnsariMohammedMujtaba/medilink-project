const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const cors = require('cors'); 
const path = require('path');

const app = express();
// Vercel uses process.env.PORT
const port = process.env.PORT || 3000; 
const PAGE_SIZE = 20; 

let interactions = []; 
let uniqueDrugNames = new Set();
let drugDetails = []; 
let contraindicationData = []; 
let contraindicationTerms = new Set(); 
let allFilterData = {}; 

app.use(cors());

// STATIC FILE SERVING IS REMOVED. Vercel handles this.

// --- LOADER 1: Your interactions CSV ---
// --- PATH FIXED: Added '../' to go up one folder ---
const csvPath1 = path.join(__dirname, '../drug-data.csv');
fs.createReadStream(csvPath1)
  .on('error', (err) => { 
    console.error('!!! FAILED TO READ drug-data.csv !!!', err);
  })
  .pipe(csv())
  .on('data', (row) => {
    interactions.push(row);
    if (row['Drug 1']) uniqueDrugNames.add(row['Drug 1'].trim().toLowerCase());
    if (row['Drug 2']) uniqueDrugNames.add(row['Drug 2'].trim().toLowerCase());
  })
  .on('end', () => {
    uniqueDrugNames = [...uniqueDrugNames].sort(); 
    console.log(`drug-data.csv successfully loaded. ${interactions.length} records found.`);
    checkIfServerReady();
  });

// --- LOADER 2: Your drug type CSV ---
// --- PATH FIXED: Added '../' to go up one folder ---
const csvPath2 = path.join(__dirname, '../Drugs-Type.csv');
fs.createReadStream(csvPath2)
  .on('error', (err) => { 
    console.error('!!! FAILED TO READ Drugs-Type.csv !!!', err);
  })
  .pipe(csv())
  .on('data', (row) => {
    if (row.Type) {
        drugDetails.push(row);
        
        const type = (row.Type || '').toLowerCase().trim();
        if (!type) return; 

        if (!allFilterData[type]) {
            allFilterData[type] = {
                brandNames: new Set(),
                genericNames: new Set(),
                manufacturers: new Set()
            };
        }

        const addToSet = (set, value) => {
            if (value && value.toLowerCase() !== 'false') {
                set.add(value.trim()); 
            }
        };
        
        addToSet(allFilterData[type].brandNames, row['Brand-Name']);
        addToSet(allFilterData[type].genericNames, row['GenericName']);
        addToSet(allFilterData[type].manufacturers, row['Manufacturer']);
    }
  })
  .on('end', () => {
    console.log(`Drugs-Type.csv successfully loaded. ${drugDetails.length} records found.`);
    for (const type in allFilterData) {
        allFilterData[type].brandNames = [...allFilterData[type].brandNames].sort();
        allFilterData[type].genericNames = [...allFilterData[type].genericNames].sort();
        allFilterData[type].manufacturers = [...allFilterData[type].manufacturers].sort();
    }
    console.log(`Filter data processed for ${Object.keys(allFilterData).length} types.`);
    checkIfServerReady();
  });

// --- LOADER 3: Your contraindication CSV ---
// --- PATH FIXED: Added '../' to go up one folder ---
const csvPath3 = path.join(__dirname, '../drug-contraindication.csv');
fs.createReadStream(csvPath3)
  .on('error', (err) => { 
    console.error('!!! FAILED TO READ drug-contraindication.csv !!!', err);
  })
  .pipe(csv())
  .on('data', (row) => {
      contraindicationData.push(row);
      
      const terms = (row.contraindications || '').toLowerCase(); 
      const splitTerms = terms.split(/[,;]/); 
      
      splitTerms.forEach(term => {
          const cleanedTerm = term.trim();
          if (cleanedTerm && cleanedTerm.length > 2 && cleanedTerm !== 'false') {
              contraindicationTerms.add(cleanedTerm);
          }
      });
  })
  .on('end', () => {
      console.log(`drug-contraindication.csv successfully loaded. ${contraindicationData.length} records found.`);
      contraindicationTerms = [...contraindicationTerms].sort();
      console.log(`Found ${contraindicationTerms.length} unique contraindication terms.`);
      checkIfServerReady();
  });

// --- Helper to log server ready ---
let filesLoaded = 0;
function checkIfServerReady() {
    filesLoaded++;
    if (filesLoaded === 3) { 
        console.log(`All CSV files loaded. Server is ready!`);
    }
}
  
// --- All APIs ---
// By default, Vercel will make this file available at /api
// So we just need to define the routes *after* /api

// --- ROUTE FIXED: Added /api prefix ---
app.get('/api/search-drug', (req, res) => {
  const term = (req.query.term || '').toLowerCase();
  if (!term) {
    return res.json([]);
  }
  const results = uniqueDrugNames.filter(name => 
    name.startsWith(term)
  );
  res.json(results.slice(0, 10));
});

// --- ROUTE FIXED: Added /api prefix ---
app.get('/api/check-interactions', (req, res) => {
  const drugQuery = req.query.drugs;
  if (!drugQuery) {
    return res.status(400).json({ error: 'No drugs provided.' });
  }
  const drugList = drugQuery.split(',').map(d => d.trim().toLowerCase());
  if (drugList.length < 2) {
     return res.status(400).json({ error: 'Please provide at least two drugs.' });
  }
  let foundInteractions = [];
  for (let i = 0; i < drugList.length; i++) {
    for (let j = i + 1; j < drugList.length; j++) {
      const drugA = drugList[i];
      const drugB = drugList[j];
      const match = interactions.find(row => {
        const drug1_csv = row['Drug 1'] ? row['Drug 1'].toLowerCase() : '';
        const drug2_csv = row['Drug 2'] ? row['Drug 2'].toLowerCase() : '';
        return (drug1_csv === drugA && drug2_csv === drugB) || 
               (drug1_csv === drugB && drug2_csv === drugA);
      });
      if (match) {
        foundInteractions.push({
          drugs: [drugA, drugB],
          description: match['Interaction Description']
        });
      }
    }
  }
  res.json(foundInteractions);
});

app.get('/api/drug-filters', (req, res) => {
    const drugType = (req.query.type || '').toLowerCase();
    if (allFilterData[drugType]) {
        res.json(allFilterData[drugType]);
    } else {
        res.json({ brandNames: [], genericNames: [], manufacturers: [] });
    }
});

app.get('/api/drugs-by-type', (req, res) => {
  // ... (no changes to the logic inside this function) ...
  const drugType = (req.query.type || '').toLowerCase();
  const brandName = (req.query.brandName || '').toLowerCase(); 
  const genericName = (req.query.genericName || '').toLowerCase(); 
  const manufacturer = (req.query.manufacturer || '').toLowerCase(); 
  const page = parseInt(req.query.page || '1', 10);
  if (!drugType) {
    return res.status(400).json({ error: 'No drug type provided.' });
  }
  let filteredResults = drugDetails.filter(drug => {
    if ((drug.Type || '').toLowerCase().trim() !== drugType) {
        return false;
    }
    const check = (csvValue, filterValue) => {
        const csvData = (csvValue || '').toLowerCase().trim();
        return !filterValue || csvData === filterValue; 
    };
    if (!check(drug['Brand-Name'], brandName)) return false;
    if (!check(drug['GenericName'], genericName)) return false;
    if (!check(drug['Manufacturer'], manufacturer)) return false;
    return true;
  });
  const totalMatches = filteredResults.length;
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = page * PAGE_SIZE;
  const paginatedDrugs = filteredResults.slice(startIndex, endIndex);
  const results = paginatedDrugs.map(drug => ({
      brandName: drug['Brand-Name'],
      genericName: drug['GenericName'],
      manufacturer: drug['Manufacturer']
  }));
  res.json({
      drugs: results,
      totalMatches: totalMatches,
      currentPage: page,
      pageSize: PAGE_SIZE
  });
});

app.get('/api/search-contraindications', (req, res) => {
  // ... (no changes to the logic inside this function) ...
    const contraTerm = (req.query.contra || '').toLowerCase().trim();
    const drugName = (req.query.drug || '').toLowerCase().trim();
    if (contraTerm.length < 3 || drugName.length < 2) { 
        return res.json([]);
    }
    const results = contraindicationData
      .filter(row => {
          const contraMatch = (row.contraindications || '').toLowerCase().includes(contraTerm);
          const drugMatch = (row.drug_name || '').toLowerCase() === drugName;
          return contraMatch && drugMatch;
      })
      .map(row => ({
          drug_name: row.drug_name,
          manufacturer: row.manufacturer,
          indications: row.indications,
          side_effects: row.side_effects,
          warnings: row.warnings
      }));
    res.json(results);
});

app.get('/api/contraindication-suggestions', (req, res) => {
  // ... (no changes to the logic inside this function) ...
    const term = (req.query.term || '').toLowerCase().trim();
    if (term.length < 2) {
        return res.json([]);
    }
    const results = contraindicationTerms.filter(t => t.startsWith(term));
    res.json(results.slice(0, 10));
});

app.get('/api/drug-suggestions-by-contra', (req, res) => {
  // ... (no changes to the logic inside this function) ...
    const contraTerm = (req.query.contra || '').toLowerCase().trim();
    const drugTerm = (req.query.term || '').toLowerCase().trim();
    if (contraTerm.length < 2 || drugTerm.length < 2) {
        return res.json([]);
    }
    const matchingDrugs = new Set();
    contraindicationData.forEach(row => {
        const drugName = (row.drug_name || ''); 
        const contraMatch = (row.contraindications || '').toLowerCase().includes(contraTerm);
        const drugMatch = drugName.toLowerCase().startsWith(drugTerm);
        if (contraMatch && drugMatch) {
            matchingDrugs.add(drugName);
        }
    });
    res.json([...matchingDrugs].sort().slice(0, 10));
});


// --- ALL HTML PAGE ROUTES ARE REMOVED ---

// --- Start the server ---
// This part is only for local testing. Vercel runs the app.
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running locally on http://localhost:${port}`);
    console.log(`Loading CSV data...`);
  });
}

// --- EXPORT THE APP FOR VERCEL ---
module.exports = app;