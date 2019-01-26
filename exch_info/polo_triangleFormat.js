var fs = require('fs');
const polo_triangles = require('./polo_triangles.json');

//console.log(polo_triangles)
let triangleObj = {  }
for(let i = 0; i <= polo_triangles.length - 1; i++) {

    //console.log(polo_triangles[i].Path)
    let tri = polo_triangles[i].Path.split(' ')
    let newTri = []
    for(let x = 0; x <= tri.length - 1; x++) {

        let pair = tri[x].split('_')
        pair.unshift('polo')
        pair = pair.join(' ')
        // console.log(pair)
        newTri.push(pair)
    }

    newTri = newTri.join(' ')

    if(triangleObj[polo_triangles[i].Base] === undefined) {
        triangleObj[polo_triangles[i].Base] = [ newTri ]
    } else {
        triangleObj[polo_triangles[i].Base].push(newTri)
    }
}


Object.keys(triangleObj).forEach((coin, i) => {
    triangleObj[coin] = [ ...new Set([].concat.apply([], triangleObj[coin])) ]
})

Object.keys(triangleObj).forEach((coin, i) => {
    console.log(coin)

    let ables = triangleObj[coin]
    let triangle = []
    let trangles = []
    console.log(ables)

    for(let v = 0; v <= ables.length - 1; v++) {
        let angles = ables[v].split(' ')
        let a_1 = angles.slice(0, 3).join(' ');
        let a_2 = angles.slice(3, 6).join(' ');
        let a_3 = angles.slice(6, 9).join(' ');
        triangle = [ a_1, a_2, a_3 ]
        trangles.push(triangle)
    }
    triangleObj[coin] = trangles
    console.log(triangleObj)
})

//console.log(triangleObj)

let json = JSON.stringify(triangleObj);

fs.writeFile('polo_tri_obj.json', json, 'utf8', () => { console.log('json') }); 

// fs.readFile('myjsonfile.json', 'utf8', function readFileCallback(err, data){
//     if (err){
//         console.log(err);
//     } else {
//     obj = JSON.parse(data); //now it an object
//     obj.table.push({id: 2, square:3}); //add some data
//     json = JSON.stringify(obj); //convert it back to json
//     // write it back 
// }});