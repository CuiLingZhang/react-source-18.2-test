import * as React from 'react';

const { useEffect } = React;
function Index(props) {

  useEffect(() => {
    // const test = React.createElement('div');
    // console.log('test', test);
    console.log('effect');
  }, []);

  return (
    <div>
      Test createElement
    </div>
  );
}

export default Index;
